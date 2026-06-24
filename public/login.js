const loginForm = document.getElementById('loginForm');
const loginMessage = document.getElementById('loginMessage');

async function parseJsonSafely(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text || 'Sunucudan gelen yanıt JSON değil.');
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginMessage.className = 'message';
  loginMessage.textContent = '';

  const formData = new FormData(loginForm);
  const payload = {
    username: formData.get('username').trim(),
    password: formData.get('password')
  };

  try {
    const response = await fetch('/api/barber-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await parseJsonSafely(response);
    if (!response.ok) throw new Error(result.error || 'Giriş yapılamadı.');

    window.location.href = '/admin.html';
  } catch (error) {
    loginMessage.textContent = error.message;
    loginMessage.classList.add('error');
  }
});
