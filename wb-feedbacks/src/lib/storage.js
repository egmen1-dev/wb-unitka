const TOKEN_KEY = 'wb-feedbacks:token';

export function loadToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function saveToken(token) {
  try {
    const trimmed = String(token || '').trim();
    if (trimmed) localStorage.setItem(TOKEN_KEY, trimmed);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // private mode
  }
}
