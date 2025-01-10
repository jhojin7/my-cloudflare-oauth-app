/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export default {
	async fetch(request, env, ctx) {
	  const url = new URL(request.url);
	  const path = url.pathname;
  
	  const CLIENT_ID = env.CLIENT_ID;
	  const CLIENT_SECRET = env.CLIENT_SECRET;
	  const REDIRECT_URI = 'https://my-cloudflare-oauth-app.jhojin7.workers.dev/callback';
	  const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
	  const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo';
	  const AUTHORIZATION_URL = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
		REDIRECT_URI
	  )}&response_type=code&scope=openid%20email%20profile`;
  
	  const COOKIE_NAME = 'user_session';
  
	  if (path === '/login') {
		console.log(CLIENT_ID)
		return Response.redirect(AUTHORIZATION_URL, 302);
	  }
  
	  if (path === '/callback') {
		const code = url.searchParams.get('code');
		if (!code) {
		  return new Response('Authorization code not found', { status: 400 });
		}
  
		const tokenResponse = await fetch(TOKEN_ENDPOINT, {
		  method: 'POST',
		  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		  body: new URLSearchParams({
			code,
			client_id: CLIENT_ID,
			client_secret: CLIENT_SECRET,
			redirect_uri: REDIRECT_URI,
			grant_type: 'authorization_code',
		  }),
		});
		const tokenData = await tokenResponse.json();
  
		if (!tokenData.access_token) {
		  return new Response('Failed to obtain access token', { status: 500 });
		}
  
		const userResponse = await fetch(USERINFO_ENDPOINT, {
		  headers: { Authorization: `Bearer ${tokenData.access_token}` },
		});
		const userData = await userResponse.json();
  
		const sessionId = crypto.randomUUID();
		await env.SESSIONS.put(sessionId, JSON.stringify(userData), { expirationTtl: 3600 });
  
		const headers = new Headers({
		  'Set-Cookie': `${COOKIE_NAME}=${sessionId}; HttpOnly; Path=/; Max-Age=3600`,
		  'Content-Type': 'text/html',
		});
  
		return new Response(
		  `<html><body><h1>Login successful!</h1><a href="/profile">Go to Profile</a></body></html>`,
		  { headers }
		);
	  }
  
	  if (path === '/profile') {
		const cookieHeader = request.headers.get('Cookie');
		if (!cookieHeader || !cookieHeader.includes(COOKIE_NAME)) {
		  return new Response('You are not logged in. <a href="/login">Login</a>', {
			headers: { 'Content-Type': 'text/html' },
		  });
		}
  
		const sessionId = cookieHeader
		  .split('; ')
		  .find((row) => row.startsWith(COOKIE_NAME))
		  .split('=')[1];
  
		const userData = await env.SESSIONS.get(sessionId);
		if (!userData) {
		  return new Response('Session expired. <a href="/login">Login</a>', {
			headers: { 'Content-Type': 'text/html' },
		  });
		}
  
		const user = JSON.parse(userData);
		return new Response(
		  `<html>
			<body>
			  <h1>Profile Page</h1>
			  <p><strong>Name:</strong> ${user.name}</p>
			  <p><strong>Email:</strong> ${user.email}</p>
			  <img src="${user.picture}" alt="Profile Picture" />
			  <br/><a href="/logout">Log out</a>
			</body>
		  </html>`,
		  { headers: { 'Content-Type': 'text/html' } }
		);
	  }
  
	  if (path === '/logout') {
		const cookieHeader = request.headers.get('Cookie');
		if (cookieHeader && cookieHeader.includes(COOKIE_NAME)) {
		  const sessionId = cookieHeader
			.split('; ')
			.find((row) => row.startsWith(COOKIE_NAME))
			.split('=')[1];
		  await env.SESSIONS.delete(sessionId);
		}
  
		const headers = new Headers({
		  'Set-Cookie': `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`,
		  'Content-Type': 'text/html',
		});
  
		return new Response(
		  `<html><body><h1>You have been logged out.</h1><a href="/login">Login again</a></body></html>`,
		  { headers }
		);
	  }
  
	  return new Response('Not found', { status: 404 });
	},
  };
