/* Domo staff login gate for internal pages (domo-leads Supabase project).
 *
 * Usage — in <head>, after supabase-js and before the page's own scripts:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="/auth-gate.js"></script>
 *
 * What it does:
 *  - Hides the page and shows a login screen until a staff member signs in.
 *  - Staff = confirmed email listed in public.staff_allowlist (checked by public.is_staff()).
 *    The database (RLS) is the real enforcement; this screen is the front door.
 *  - supabase-js clients the page creates for this project pick up the stored session
 *    automatically. Raw fetch() calls that send the publishable/anon key as the bearer
 *    are upgraded to the signed-in user's token.
 *  - First time: "Crear contraseña" signs up (only allowlisted emails can), then the person
 *    confirms by email and signs in. "Olvidé mi contraseña" sends a reset link.
 */
(function () {
  var SB_URL = 'https://dowkxvpdpqqaufjqcjmp.supabase.co';
  var SB_KEY = 'sb_publishable_huGBVu5PdCVrXb558dAhZQ_AiIZk9gO';
  var STORAGE_KEY = 'sb-dowkxvpdpqqaufjqcjmp-auth-token';

  if (!window.supabase || !window.supabase.createClient) {
    console.error('auth-gate: load supabase-js before auth-gate.js');
    return;
  }

  function storedSession() {
    try { var raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }

  // Until the database requires login (public.staff_login_required()), people may choose
  // "Más tarde" and keep using the page with the public key for this browser session.
  var LATER_KEY = 'domo-auth-later';
  function laterChosen() { try { return sessionStorage.getItem(LATER_KEY) === '1'; } catch (e) { return false; } }
  function setLater(on) { try { on ? sessionStorage.setItem(LATER_KEY, '1') : sessionStorage.removeItem(LATER_KEY); } catch (e) {} }
  var loginOptional = false;

  // Hide the page right away if nobody is signed in (avoids a flash of an empty board).
  var root = document.documentElement;
  if (!storedSession() && !laterChosen()) root.classList.add('domo-locked');

  var client = window.supabase.createClient(SB_URL, SB_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: STORAGE_KEY }
  });

  // ---------- fetch upgrade: anon bearer -> user token for this project ----------
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
      if (url.indexOf(SB_URL + '/rest/v1/') === 0 || url.indexOf(SB_URL + '/functions/v1/') === 0) {
        var req = new Request(input, init);
        if (isAnonBearer(req.headers.get('authorization'))) {
          var s = (await client.auth.getSession()).data.session;
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

  var mode = /type=recovery/.test(location.hash) ? 'recovery' : 'login'; // login | signup | forgot | recovery | denied
  var overlay;

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
      login: ['Domo · Equipo', 'Entra con tu correo de Domo.'],
      signup: ['Crear contraseña', 'Solo la primera vez. Te enviaremos un correo para confirmar.'],
      forgot: ['Olvidé mi contraseña', 'Te enviaremos un enlace para crear una nueva.'],
      recovery: ['Nueva contraseña', 'Escribe tu nueva contraseña.'],
      denied: ['Sin acceso', 'Este correo no tiene acceso al equipo Domo. Pídele acceso a Néstor.']
    };
    card.appendChild(el('h1', null, titles[mode][0]));
    card.appendChild(el('p', null, titles[mode][1]));

    var form = el('form');
    var email, pass;
    if (mode === 'login' || mode === 'signup' || mode === 'forgot') {
      form.appendChild(el('label', { 'for': 'domo-auth-email' }, 'Correo'));
      email = el('input', { id: 'domo-auth-email', type: 'email', autocomplete: 'username', required: '' });
      form.appendChild(email);
    }
    if (mode === 'login' || mode === 'signup' || mode === 'recovery') {
      form.appendChild(el('label', { 'for': 'domo-auth-pass' }, 'Contraseña'));
      pass = el('input', mode === 'login'
        ? { id: 'domo-auth-pass', type: 'password', required: '', autocomplete: 'current-password' }
        : { id: 'domo-auth-pass', type: 'password', required: '', minlength: '8', autocomplete: 'new-password' });
      form.appendChild(pass);
    }
    var labels = { login: 'Entrar', signup: 'Crear contraseña', forgot: 'Enviar enlace', recovery: 'Guardar', denied: 'Salir' };
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
          res = await client.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
          if (res.error) throw res.error;
          return afterSignIn();
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
    function link(text, next) { var a = el('a', null, text); a.addEventListener('click', function () { mode = next; render(); }); links.appendChild(a); }
    if (mode === 'login') { link('Primera vez: crear contraseña', 'signup'); link('Olvidé mi contraseña', 'forgot'); }
    else if (mode !== 'denied') link('Volver', 'login');
    card.appendChild(links);
    if (mode === 'login' && loginOptional) {
      var later = el('div', { 'class': 'links' });
      var a = el('a', null, 'Más tarde (por ahora es opcional)');
      a.addEventListener('click', function () { setLater(true); continueWithoutLogin(); });
      later.appendChild(a);
      card.appendChild(later);
    }
    overlay.appendChild(card);
    var first = overlay.querySelector('input'); if (first) first.focus();
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

  function showChip(emailAddr) {
    if (!document.body) { document.addEventListener('DOMContentLoaded', function () { showChip(emailAddr); }); return; }
    if (document.getElementById('domo-auth-chip')) return;
    var chip = el('div', { id: 'domo-auth-chip' }, emailAddr || '');
    var out = el('a', null, 'Salir');
    out.addEventListener('click', async function () { await client.auth.signOut(); location.reload(); });
    chip.appendChild(out);
    document.body.appendChild(chip);
  }

  function continueWithoutLogin() {
    if (overlay) { overlay.remove(); overlay = null; }
    root.classList.remove('domo-locked');
    if (!document.body) { document.addEventListener('DOMContentLoaded', continueWithoutLogin); return; }
    if (document.getElementById('domo-auth-chip')) return;
    var chip = el('div', { id: 'domo-auth-chip' }, 'Sin sesión');
    var go = el('a', null, 'Entrar');
    go.addEventListener('click', function () { setLater(false); chip.remove(); mode = 'login'; render(); });
    chip.appendChild(go);
    document.body.appendChild(chip);
  }

  async function checkLoginOptional() {
    var r = await client.rpc('staff_login_required');
    loginOptional = !r.error && r.data === false;
    return loginOptional;
  }

  var hadSessionAtLoad = !!storedSession();
  async function afterSignIn() {
    if (!(await checkStaff())) { mode = 'denied'; return render(); }
    // The page booted without a session; reload so it loads its data as the signed-in user.
    location.reload();
  }

  var ready = (async function () {
    var s = (await client.auth.getSession()).data.session;
    if (mode === 'recovery') { render(); return s; } // arrived via password-reset link
    if (!s) {
      await checkLoginOptional();
      if (loginOptional && laterChosen()) { continueWithoutLogin(); return null; }
      setLater(false);
      mode = 'login'; render(); return null;
    }
    if (!(await checkStaff())) { mode = 'denied'; render(); return null; }
    if (!hadSessionAtLoad) { location.reload(); return null; } // e.g. arrived via confirmation link
    root.classList.remove('domo-locked');
    showChip(s.user && s.user.email);
    return s;
  })();

  client.auth.onAuthStateChange(function (event) {
    if (event === 'PASSWORD_RECOVERY') { mode = 'recovery'; render(); }
    else if (event === 'SIGNED_OUT') { mode = 'login'; render(); }
  });

  window.DomoAuth = {
    client: client,
    ready: ready,
    signOut: async function () { await client.auth.signOut(); location.reload(); }
  };
})();
