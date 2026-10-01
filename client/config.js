// Where the game server (Worker + Durable Objects) lives.
// Leave empty when the client is served by the same Worker (default setup).
// If you host the client on Cloudflare Pages separately, set this to your
// Worker's URL, e.g. 'https://office-hours.your-account.workers.dev'.
window.OFFICE_HOURS_CONFIG = {
  serverUrl: '',
};
