"use strict";

// Compte (pseudo + code à 4 chiffres) et groupes, via Firebase Auth + Firestore.
// L'app marche sans : les données restent sur le téléphone, seul le résumé partagé avec
// les groupes part au serveur. Le SDK est chargé à la demande ; hors ligne, on réessaie plus tard.
const Cloud = (() => {
  const SDK = "https://www.gstatic.com/firebasejs/12.4.0/";
  const ACCOUNT_KEY = "calliboss.account";
  const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans 0/O ni 1/I
  const enabled = typeof FIREBASE_CONFIG !== "undefined" && !!FIREBASE_CONFIG;

  // Compte connu de ce téléphone : { uid, pseudo, groups: [{ code, name }], sent }
  let account = null;
  try {
    account = JSON.parse(localStorage.getItem(ACCOUNT_KEY));
  } catch (e) {}
  function keep() {
    if (account) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
    else localStorage.removeItem(ACCOUNT_KEY);
  }

  let sdkPromise = null;
  function sdk() {
    if (!sdkPromise)
      sdkPromise = (async () => {
        const [app, auth, fs] = await Promise.all([
          import(SDK + "firebase-app.js"),
          import(SDK + "firebase-auth.js"),
          import(SDK + "firebase-firestore-lite.js"),
        ]);
        const a = app.initializeApp(FIREBASE_CONFIG);
        const au = auth.getAuth(a);
        await au.authStateReady();
        return { auth, fs, au, db: fs.getFirestore(a) };
      })().catch((e) => {
        sdkPromise = null;
        throw e;
      });
    return sdkPromise;
  }

  // Erreur dont le message est déjà prêt à afficher.
  function fail(msg) {
    const e = new Error(msg);
    e.user = true;
    return e;
  }
  function message(e) {
    if (e && e.user) return e.message;
    const code = (e && e.code) || "";
    if (code === "auth/network-request-failed" || code === "unavailable" || e instanceof TypeError) return "Pas de connexion, réessaie plus tard";
    if (code === "auth/too-many-requests") return "Trop d'essais, réessaie dans quelques minutes";
    if (code === "auth/operation-not-allowed" || code === "auth/configuration-not-found") return "La connexion par mot de passe n'est pas activée dans Firebase";
    if (code === "permission-denied") return "Accès refusé : tu n'es peut-être plus dans ce groupe";
    return "Erreur : " + (code || (e && e.message) || "inconnue");
  }

  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
    return h.toString(36) + "." + str.length;
  }

  async function groupNames(codes) {
    const { fs, db } = await sdk();
    const snaps = await Promise.all(codes.map((c) => fs.getDoc(fs.doc(db, "groups", c))));
    return snaps.filter((s) => s.exists()).map((s) => ({ code: s.id, name: String(s.data().name || s.id) }));
  }
  function memberRef(fs, db, code) {
    return fs.doc(db, "groups", code, "members", account.uid);
  }
  function memberDoc(data) {
    return { pseudo: account.pseudo, updated: Date.now(), data };
  }

  // Un seul formulaire : se connecte si le pseudo existe avec ce code, sinon propose de le créer.
  // Firebase Auth veut un e-mail et 6 caractères : on les fabrique à partir du pseudo et du code.
  // Renvoie null si la création est refusée par `confirmCreate`.
  async function login(pseudo, pin, confirmCreate) {
    const display = pseudo.trim();
    const id = display.toLowerCase();
    if (!/^[a-z0-9_-]{3,20}$/.test(id)) throw fail("Pseudo : 3 à 20 caractères, lettres sans accent, chiffres, - ou _");
    if (!/^\d{4}$/.test(pin)) throw fail("Le code doit faire 4 chiffres");
    const { auth, fs, au, db } = await sdk();
    const email = `${id}@calliboss.invalid`;
    const password = `calliboss-${pin}`;
    let cred;
    try {
      cred = await auth.signInWithEmailAndPassword(au, email, password);
    } catch (e) {
      if (e.code === "auth/wrong-password") throw fail("Code incorrect pour ce pseudo");
      if (!["auth/invalid-credential", "auth/invalid-login-credentials", "auth/user-not-found"].includes(e.code)) throw e;
      if (!confirmCreate(display)) return null;
      try {
        cred = await auth.createUserWithEmailAndPassword(au, email, password);
      } catch (e2) {
        if (e2.code === "auth/email-already-in-use") throw fail("Ce pseudo existe déjà et le code ne correspond pas");
        throw e2;
      }
    }
    const uid = cred.user.uid;
    const ref = fs.doc(db, "users", uid);
    const snap = await fs.getDoc(ref);
    let name = display;
    let codes = [];
    if (snap.exists()) {
      name = snap.data().pseudo || display;
      codes = snap.data().groups || [];
    } else await fs.setDoc(ref, { pseudo: display, groups: [] });
    account = { uid, pseudo: name, groups: [], sent: "" };
    account.groups = await groupNames(codes);
    keep();
    return account;
  }

  // Les séances restent sur le téléphone ; le compte reste membre de ses groupes.
  async function logout() {
    account = null;
    keep();
    const { auth, au } = await sdk();
    await auth.signOut(au);
  }

  // Au démarrage : vérifie que la session est toujours valide et relit la liste des groupes.
  async function sync() {
    if (!enabled || !account) return;
    const { fs, au, db } = await sdk();
    if (!au.currentUser || au.currentUser.uid !== account.uid) {
      account = null;
      keep();
      return;
    }
    const snap = await fs.getDoc(fs.doc(db, "users", account.uid));
    if (!snap.exists()) return;
    account.groups = await groupNames(snap.data().groups || []);
    keep();
  }

  async function joinGroup(code, data) {
    code = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) throw fail("Le code d'un groupe fait 6 caractères");
    if (account.groups.some((g) => g.code === code)) throw fail("Tu es déjà dans ce groupe");
    const { fs, db } = await sdk();
    const snap = await fs.getDoc(fs.doc(db, "groups", code));
    if (!snap.exists()) throw fail("Aucun groupe avec ce code");
    await fs.setDoc(memberRef(fs, db, code), memberDoc(data));
    await fs.setDoc(fs.doc(db, "users", account.uid), { groups: fs.arrayUnion(code) }, { merge: true });
    const group = { code, name: String(snap.data().name || code) };
    account.groups.push(group);
    keep();
    return group;
  }

  async function createGroup(name, data) {
    name = name.trim();
    if (!name || name.length > 40) throw fail("Donne un nom au groupe (40 caractères max)");
    const { fs, db } = await sdk();
    const rnd = crypto.getRandomValues(new Uint8Array(6));
    const code = Array.from(rnd, (n) => CODE_CHARS[n % CODE_CHARS.length]).join("");
    // Refusé par les règles si le code existe déjà (1 chance sur un milliard).
    await fs.setDoc(fs.doc(db, "groups", code), { name, owner: account.uid, created: Date.now() });
    return joinGroup(code, data);
  }

  async function leaveGroup(code) {
    const { fs, db } = await sdk();
    await fs.deleteDoc(memberRef(fs, db, code));
    await fs.setDoc(fs.doc(db, "users", account.uid), { groups: fs.arrayRemove(code) }, { merge: true });
    account.groups = account.groups.filter((g) => g.code !== code);
    keep();
  }

  // Membres d'un groupe : [{ uid, pseudo, updated, data }]. `data` vient des autres : à ne jamais afficher sans échappement.
  async function members(code) {
    const { fs, db } = await sdk();
    const snap = await fs.getDocs(fs.collection(db, "groups", code, "members"));
    return snap.docs.map((d) => {
      const v = d.data();
      let data = {};
      try {
        data = JSON.parse(v.data) || {};
      } catch (e) {}
      return { uid: d.id, pseudo: String(v.pseudo || "?"), updated: +v.updated || 0, data };
    });
  }

  // Envoie le résumé partagé (une chaîne JSON) à chaque groupe, seulement s'il a changé.
  async function publish(data) {
    if (!enabled || !account || !account.groups.length) return false;
    const h = hash(data);
    if (account.sent === h) return false;
    const { fs, au, db } = await sdk();
    if (!au.currentUser || au.currentUser.uid !== account.uid) return false;
    await Promise.all(account.groups.map((g) => fs.setDoc(memberRef(fs, db, g.code), memberDoc(data))));
    account.sent = h;
    keep();
    return true;
  }

  return {
    enabled,
    get account() {
      return account;
    },
    login,
    logout,
    sync,
    createGroup,
    joinGroup,
    leaveGroup,
    members,
    publish,
    message,
  };
})();
