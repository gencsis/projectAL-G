/* Login and register screen. Opens from the Login button (top right) or when a guest tries to build.
   Accounts are on the server (server.js); you register once, then log in. */
(() => {
'use strict';
const G = window.marsGrid, $ = s => document.querySelector(s);
let registering = false;

function showLogin(reg = false) {
  registering = reg;
  $('#login').hidden = false;
  $('#loginTitle').textContent = reg ? 'Create an account' : 'Log in';
  $('#loginGo').textContent = reg ? 'Register' : 'Login';
  $('#pass').autocomplete = reg ? 'new-password' : 'current-password';
  $('#switchText').textContent = reg ? 'Already have an account?' : 'New here?';
  $('#switchMode').textContent = reg ? 'Log in' : 'Register';
  $('#loginMsg').textContent = ''; $('#loginMsg').className = '';
  $('#user').focus();
}
const hideLogin = () => { $('#login').hidden = true; $('#pass').value = ''; };
function say(text, ok = false) { $('#loginMsg').textContent = text; $('#loginMsg').className = ok ? 'ok' : ''; }

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const body = { name: $('#user').value.trim(), password: $('#pass').value };
  try {
    if (registering) {
      await G.call('POST', '/api/register', body);
      showLogin(false); $('#user').value = body.name; $('#pass').focus();
      say('Account created. Now log in.', true);
    } else {
      await G.call('POST', '/api/login', body);
      hideLogin(); await G.refresh();
    }
  } catch (err) { say(err.message); }
});
$('#switchMode').onclick = () => showLogin(!registering);
$('#loginClose').onclick = hideLogin;
$('#loginBtn').onclick = () => showLogin(false);
$('#logout').onclick = async () => { $('#side').hidden = true; try { await G.call('POST', '/api/logout'); } catch (e) {} G.refresh(); };
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#login').hidden) hideLogin(); });
window.showLogin = showLogin;
})();
