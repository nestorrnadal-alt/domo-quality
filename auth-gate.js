/* Domo staff login gate for internal pages.
 *
 * Usage — in <head>, after supabase-js and before the page's own scripts:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="/auth-gate.js"></script>                      (domo-leads pages)
 *   <script src="/auth-gate.js" data-also="quotes"></script>   (pages that also use domo-quotes)
 *   <script src="auth-gate.js" data-project="quotes"></script> (domo-quotes pages)
 *
 * What it does:
 *  - Hides the page and shows a login screen until a staff member signs in to the page's
 *    main project. Staff = confirmed email in public.staff_allowlist (public.is_staff()).
 *    The database (RLS) is the real enforcement; this screen is the front door.
 *  - supabase-js clients the page creates pick up the stored session automatically. Raw
 *    fetch() calls that send the publishable/anon key as the bearer are upgraded to the
 *    signed-in user's token (per project).
 *  - data-also: the same email + password is also used to sign in to that project. If it
 *    doesn't work and that project already requires login, the person is asked once for it.
 *  - Until a project's lockdown is applied (public.staff_login_required() = false), the
 *    login is optional: "Más tarde" lets people keep working with the public key.
 *  - First time: "Crear contraseña" signs up (only allowlisted emails can), then the person
 *    confirms by email and signs in. "Olvidé mi contraseña" sends a reset link.
 */
(function () {
  var PROJECTS = {
    leads:  { ref: 'dowkxvpdpqqaufjqcjmp', key: 'sb_publishable_huGBVu5PdCVrXb558dAhZQ_AiIZk9gO', label: 'Domo' },
    quotes: { ref: 'mpgljurndbfusxtcrogr', key: 'sb_publishable_eSqiIIUFZck9XFdpgE3Ctg_u3-lBI88', label: 'Cotizaciones' }
  };

  if (!window.supabase || !window.supabase.createClient) {
    console.error('auth-gate: load supabase-js before auth-gate.js');
    return;
  }

  var tag = document.currentScript || {};
  var data = tag.dataset || {};
  var mainName = PROJECTS[data.project] ? data.project : 'leads';
  var alsoNames = String(data.also || '').split(/[\s,]+/).filter(function (n) { return PROJECTS[n] && n !== mainName; });

  function makeProject(name) {
    var p = PROJECTS[name];
    var url = 'https://' + p.ref + '.supabase.co';
    var storageKey = 'sb-' + p.ref + '-auth-token';
    return {
      name: name, label: p.label, url: url, storageKey: storageKey,
      client: window.supabase.createClient(url, p.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: name === mainName, storageKey: storageKey }
      })
    };
  }
  function storedSession(p) {
    try { var raw = localStorage.getItem(p.storageKey); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }

  var main = makeProject(mainName);
  var also = alsoNames.map(makeProject);
  var all = [main].concat(also);
  var client = main.client;

  // Until the database requires login, people may choose "Más tarde" for this browser session.
  var LATER_KEY = 'domo-auth-later-' + mainName;
  function laterChosen() { try { return sessionStorage.getItem(LATER_KEY) === '1'; } catch (e) { return false; } }
  function setLater(on) { try { on ? sessionStorage.setItem(LATER_KEY, '1') : sessionStorage.removeItem(LATER_KEY); } catch (e) {} }
  var loginOptional = false;

  // Hide the page right away if nobody is signed in (avoids a flash of an empty board).
  var root = document.documentElement;
  if (!storedSession(main) && !laterChosen()) root.classList.add('domo-locked');

  // ---------- fetch upgrade: anon bearer -> user token, per project ----------
  var nativeFetch = window.fetch.bind(window);
  function isAnonBearer(auth) {
    if (!auth) return true;
    var tok = auth.replace(/^Bearer\s+/i, '');
    if (tok.indexOf('sb_publishable_') === 0) return true;
    // Legacy anon JWT some pages still send; treated the same as the publishable key.
    try {
      var payload = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return payload.role === 'anon';
    } catch (e) { return false; }
  }
  window.fetch = async function (input, init) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || String(input);
      for (var i = 0; i < all.length; i++) {
        var p = all[i];
        if (url.indexOf(p.url + '/rest/v1/') !== 0 && url.indexOf(p.url + '/functions/v1/') !== 0) continue;
        var req = new Request(input, init);
        if (isAnonBearer(req.headers.get('authorization'))) {
          var s = (await p.client.auth.getSession()).data.session;
          if (s && s.access_token) {
            var headers = new Headers(req.headers);
            headers.set('Authorization', 'Bearer ' + s.access_token);
            return nativeFetch(new Request(req, { headers: headers }));
          }
        }
        return nativeFetch(req);
      }
    } catch (e) { /* fall through to the untouched request */ }
    return nativeFetch(input, init);
  };

  // ---------- UI ----------
  var css = [
    'html.domo-locked body > *:not(#domo-auth){visibility:hidden!important}',
    '#domo-auth{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;',
    ' background:#142543;font-family:Epilogue,system-ui,-apple-system,sans-serif;padding:16px;visibility:visible!important}',
    '#domo-auth .card{background:#fff;border-radius:16px;padding:28px 24px;width:100%;max-width:360px;box-shadow:0 20px 60px rgba(0,0,0,.35)}',
    '#domo-auth h1{margin:0 0 4px;font-size:22px;color:#142543}',
    '#domo-auth p{margin:0 0 16px;font-size:14px;color:#4b5563;line-height:1.4}',
    '#domo-auth label{display:block;font-size:13px;color:#142543;margin:10px 0 4px;font-weight:600}',
    '#domo-auth input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:15px}',
    '#domo-auth input:focus{outline:2px solid #80A2F9;border-color:#3652A5}',
    '#domo-auth button.primary{width:100%;margin-top:16px;padding:11px;border:0;border-radius:10px;background:#3652A5;color:#fff;font-size:15px;font-weight:600;cursor:pointer}',
    '#domo-auth button.primary:disabled{opacity:.6;cursor:wait}',
    '#domo-auth .links{display:flex;justify-content:space-between;gap:8px;margin-top:14px}',
    '#domo-auth .links a{font-size:13px;color:#3652A5;cursor:pointer;text-decoration:underline}',
    '#domo-auth .msg{margin-top:12px;font-size:13px;min-height:1em}',
    '#domo-auth .msg.err{color:#b91c1c}#domo-auth .msg.ok{color:#15803d}',
    '#domo-auth-chip{position:fixed;left:10px;bottom:10px;z-index:2147483646;background:#142543;color:#fff;',
    ' font:12px system-ui,sans-serif;padding:5px 10px;border-radius:999px;opacity:.75}',
    '#domo-auth-chip:hover{opacity:1}#domo-auth-chip a{color:#8BD7D7;cursor:pointer;margin-left:8px}'
  ].join('');
  var style = document.createElement('style');
  style.textContent = css;
  (document.head || root).appendChild(style);

  // login | signup | forgot | recovery | denied | also (sign in to a secondary project)
  var mode = /type=recovery/.test(location.hash) ? 'recovery' : 'login';
  var overlay;
  var alsoTarget = null;   // project being asked for in 'also' mode
  var alsoQueue = [];      // secondary projects still needing a session

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    for (var k in (attrs || {})) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }

  function render(message, kind) {
    if (!document.body) { document.addEventListener('DOMContentLoaded', function () { render(message, kind); }); return; }
    root.classList.add('domo-locked');
    if (!overlay) { overlay = el('div', { id: 'domo-auth' }); document.body.appendChild(overlay); }
    overlay.innerHTML = '';
    var card = el('div', { 'class': 'card' });
    var titles = {
      login: [main.label + ' · Equipo', 'Entra con tu correo de Domo.'],
      signup: ['Crear contraseña', 'Solo la primera vez. Te enviaremos un correo para confirmar.'],
      forgot: ['Olvidé mi contraseña', 'Te enviaremos un enlace para crear una nueva.'],
      recovery: ['Nueva contraseña', 'Escribe tu nueva contraseña.'],
      denied: ['Sin acceso', 'Este correo no tiene acceso al equipo Domo. Pídele acceso a Néstor.'],
      also: [alsoTarget ? alsoTarget.label : '', 'Esta página también usa ' + (alsoTarget ? alsoTarget.label : '') +
        '. Entra con tu contraseña de esa app.']
    };
    card.appendChild(el('h1', null, titles[mode][0]));
    card.appendChild(el('p', null, titles[mode][1]));

    var form = el('form');
    var email, pass;
    if (mode === 'login' || mode === 'signup' || mode === 'forgot' || mode === 'also') {
      form.appendChild(el('label', { 'for': 'domo-auth-email' }, 'Correo'));
      email = el('input', { id: 'domo-auth-email', type: 'email', autocomplete: 'username', required: '' });
      if (mode === 'also') { var se = storedSession(main); if (se && se.user) email.value = se.user.email || ''; }
      form.appendChild(email);
    }
    if (mode === 'login' || mode === 'signup' || mode === 'recovery' || mode === 'also') {
      form.appendChild(el('label', { 'for': 'domo-auth-pass' }, 'Contraseña'));
      pass = el('input', (mode === 'login' || mode === 'also')
        ? { id: 'domo-auth-pass', type: 'password', required: '', autocomplete: 'current-password' }
        : { id: 'domo-auth-pass', type: 'password', required: '', minlength: '8', autocomplete: 'new-password' });
      form.appendChild(pass);
    }
    var labels = { login: 'Entrar', signup: 'Crear contraseña', forgot: 'Enviar enlace', recovery: 'Guardar', denied: 'Salir', also: 'Entrar' };
    var btn = el('button', { type: 'submit', 'class': 'primary' }, labels[mode]);
    form.appendChild(btn);
    var msg = el('div', { 'class': 'msg' + (kind ? ' ' + kind : '') }, message || '');
    form.appendChild(msg);

    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      btn.disabled = true; msg.className = 'msg'; msg.textContent = '';
      try {
        var res, redirect = location.origin + location.pathname;
        if (mode === 'login') {
          var creds = { email: email.value.trim(), password: pass.value };
          res = await client.auth.signInWithPassword(creds);
          if (res.error) throw res.error;
          // Same email + password for the other projects this page uses (best effort).
          await Promise.all(also.map(function (p) { return p.client.auth.signInWithPassword(creds).catch(function () {}); }));
          return afterSignIn();
        } else if (mode === 'also') {
          res = await alsoTarget.client.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
          if (res.error) throw res.error;
          return location.reload();
        } else if (mode === 'signup') {
          res = await client.auth.signUp({ email: email.value.trim(), password: pass.value, options: { emailRedirectTo: redirect } });
          if (res.error) throw res.error;
          if (res.data && res.data.session) return afterSignIn();
          mode = 'login'; return render('Listo. Revisa tu correo, confirma, y luego entra aquí.', 'ok');
        } else if (mode === 'forgot') {
          res = await client.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: redirect });
          if (res.error) throw res.error;
          mode = 'login'; return render('Si el correo tiene acceso, te llegará un enlace.', 'ok');
        } else if (mode === 'recovery') {
          res = await client.auth.updateUser({ password: pass.value });
          if (res.error) throw res.error;
          return afterSignIn();
        } else if (mode === 'denied') {
          await client.auth.signOut(); mode = 'login'; return render();
        }
      } catch (e) {
        msg.className = 'msg err';
        msg.textContent = translate(e && e.message);
      } finally { btn.disabled = false; }
    });
    card.appendChild(form);

    var links = el('div', { 'class': 'links' });
    function link(text, onClick) { var a = el('a', null, text); a.addEventListener('click', onClick); links.appendChild(a); }
    if (mode === 'login') {
      link('Primera vez: crear contraseña', function () { mode = 'signup'; render(); });
      link('Olvidé mi contraseña', function () { mode = 'forgot'; render(); });
    } else if (mode === 'also') {
      link('Continuar sin ' + alsoTarget.label, function () { nextAlso(); });
    } else if (mode !== 'denied') {
      link('Volver', function () { mode = 'login'; render(); });
    }
    card.appendChild(links);
    if (mode === 'login' && loginOptional) {
      var later = el('div', { 'class': 'links' });
      var a = el('a', null, 'Más tarde (por ahora es opcional)');
      a.addEventListener('click', function () { setLater(true); continueWithoutLogin(); });
      later.appendChild(a);
      card.appendChild(later);
    }
    overlay.appendChild(card);
    var first = mode === 'also' ? pass : overlay.querySelector('input'); if (first) first.focus();
  }

  function translate(m) {
    m = String(m || 'Error');
    if (/invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
    if (/email not confirmed/i.test(m)) return 'Falta confirmar tu correo. Busca el email de confirmación.';
    if (/already registered|already exists/i.test(m)) return 'Ya tienes cuenta. Entra o usa "Olvidé mi contraseña".';
    if (/database error|not authorized|no está autorizado/i.test(m)) return 'Este correo no está autorizado para Domo.';
    if (/password/i.test(m) && /(6|8|characters|short)/i.test(m)) return 'La contraseña debe tener al menos 8 caracteres.';
    if (/rate limit|too many/i.test(m)) return 'Demasiados intentos. Espera unos minutos.';
    return m;
  }

  async function checkStaff() {
    var r = await client.rpc('is_staff');
    return !r.error && r.data === true;
  }
  async function loginRequired(p) {
    var r = await p.client.rpc('staff_login_required');
    return !(!r.error && r.data === false);
  }

  function unlock() {
    if (overlay) { overlay.remove(); overlay = null; }
    root.classList.remove('domo-locked');
  }

  function showChip(emailAddr) {
    if (!document.body) { document.addEventListener('DOMContentLoaded', function () { showChip(emailAddr); }); return; }
    if (document.getElementById('domo-auth-chip')) return;
    var chip = el('div', { id: 'domo-auth-chip' }, emailAddr || '');
    var out = el('a', null, 'Salir');
    out.addEventListener('click', async function () {
      await Promise.all(all.map(function (p) { return p.client.auth.signOut().catch(function () {}); }));
      location.reload();
    });
    chip.appendChild(out);
    document.body.appendChild(chip);
  }

  function continueWithoutLogin() {
    unlock();
    if (!document.body) { document.addEventListener('DOMContentLoaded', continueWithoutLogin); return; }
    if (document.getElementById('domo-auth-chip')) return;
    var chip = el('div', { id: 'domo-auth-chip' }, 'Sin sesión');
    var go = el('a', null, 'Entrar');
    go.addEventListener('click', function () { setLater(false); chip.remove(); mode = 'login'; render(); });
    chip.appendChild(go);
    document.body.appendChild(chip);
  }

  // Ask for secondary projects that have no session AND already require login.
  function nextAlso() {
    alsoTarget = alsoQueue.shift() || null;
    if (!alsoTarget) { unlock(); return; }
    mode = 'also'; render();
  }

  var hadSessionAtLoad = !!storedSession(main);
  async function afterSignIn() {
    if (!(await checkStaff())) { mode = 'denied'; return render(); }
    // The page booted without a session; reload so it loads its data as the signed-in user.
    location.reload();
  }

  var ready = (async function () {
    var s = (await client.auth.getSession()).data.session;
    if (mode === 'recovery') { render(); return s; } // arrived via password-reset link
    if (!s) {
      loginOptional = !(await loginRequired(main));
      if (loginOptional && laterChosen()) { continueWithoutLogin(); return null; }
      setLater(false);
      mode = 'login'; render(); return null;
    }
    if (!(await checkStaff())) { mode = 'denied'; render(); return null; }
    if (!hadSessionAtLoad) { location.reload(); return null; } // e.g. arrived via confirmation link
    showChip(s.user && s.user.email);
    for (var i = 0; i < also.length; i++) {
      var p = also[i];
      var ps = (await p.client.auth.getSession()).data.session;
      if (!ps && (await loginRequired(p))) alsoQueue.push(p);
    }
    if (alsoQueue.length) nextAlso(); else unlock();
    return s;
  })();

  client.auth.onAuthStateChange(function (event) {
    if (event === 'PASSWORD_RECOVERY') { mode = 'recovery'; render(); }
    else if (event === 'SIGNED_OUT') { mode = 'login'; render(); }
  });

  window.DomoAuth = {
    client: client,
    clients: all.reduce(function (o, p) { o[p.name] = p.client; return o; }, {}),
    ready: ready,
    signOut: async function () {
      await Promise.all(all.map(function (p) { return p.client.auth.signOut().catch(function () {}); }));
      location.reload();
    }
  };
})();
