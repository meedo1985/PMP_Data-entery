// ================================================================
// login.js — login page logic (replaces document.title polling)
// ================================================================
(function () {
  const $user  = document.getElementById('txtUser');
  const $pass  = document.getElementById('txtPass');
  const $btn   = document.getElementById('btnLogin');
  const $err   = document.getElementById('errMsg');
  const $errT  = document.getElementById('errText');

  function showError(msg) {
    $errT.textContent = msg;
    $err.style.display = 'block';
  }
  function hideError() { $err.style.display = 'none'; }

  async function doLogin() {
    const u = ($user.value || '').trim();
    const p = $pass.value || '';
    if (!u) { $user.focus(); return; }
    if (!p) { $pass.focus(); return; }

    hideError();
    $btn.disabled = true;
    $btn.textContent = 'Verifying...';

    try {
      const res = await window.pmp.auth.login(u, p);
      if (res && res.ok) {
        if (res.user && res.user.must_change_pwd) {
          await window.pmp.nav.goto('settings');
        } else {
          await window.pmp.nav.goto('dashboard');
        }
      } else {
        showError('Invalid username or password');
        $pass.value = '';
        $pass.focus();
      }
    } catch (err) {
      showError('Login error: ' + (err.message || err));
    } finally {
      $btn.disabled = false;
      $btn.textContent = 'Sign In';
    }
  }

  $btn.addEventListener('click', doLogin);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });

  // Autofocus
  window.addEventListener('load', () => $user.focus());
})();
