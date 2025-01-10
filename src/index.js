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

		// OAuth Login
		if (path === '/login') {
			return Response.redirect(AUTHORIZATION_URL, 302);
		}

		// OAuth Callback
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
				'Set-Cookie': `${COOKIE_NAME}=${sessionId}; Path=/; Max-Age=3600`,
				'Content-Type': 'text/html',
			});

			return new Response(
				`<html><body><h1>Login successful!</h1><a href="/profile">Go to Profile</a> | <a href="/todos">Go to Todos</a></body></html>`,
				{ headers }
			);
		}

		// Profile Page
		if (path === '/profile') {
			const sessionId = getSessionId(request);
			if (!sessionId) {
				return new Response('You are not logged in. <a href="/login">Login</a>', {
					headers: { 'Content-Type': 'text/html' },
				});
			}

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
			  <br/><a href="/logout">Log out</a> | <a href="/todos">Go to Todos</a>
			</body>
		  </html>`,
				{ headers: { 'Content-Type': 'text/html' } }
			);
		}

		// Todo List API
		if (path === '/api/todos') {
			const sessionId = getSessionId(request);
			if (!sessionId) return new Response('Unauthorized', { status: 401 });

			const userData = await env.SESSIONS.get(sessionId);
			if (!userData) return new Response('Session expired', { status: 401 });

			const user = JSON.parse(userData);
			const userId = user.id;

			if (request.method === 'GET') {
				const todos = (await env.TODOS.get(userId, { type: 'json' })) || [];
				return new Response(JSON.stringify(todos), {
					headers: { 'Content-Type': 'application/json' },
				});
			}

			if (request.method === 'POST') {
				const newTodo = await request.json();
				const todos = (await env.TODOS.get(userId, { type: 'json' })) || [];
				todos.push(newTodo);
				await env.TODOS.put(userId, JSON.stringify(todos));
				return new Response('Todo added', { status: 201 });
			}

			if (request.method === 'DELETE') {
				await env.TODOS.put(userId, JSON.stringify([]));
				return new Response('Todos cleared', { status: 200 });
			}

			return new Response('Method not allowed', { status: 405 });
		}

		// Todo List Page
		if (path === '/todos') {
			const sessionId = getSessionId(request);
			if (!sessionId) {
				return new Response('You are not logged in. <a href="/login">Login</a>', {
					headers: { 'Content-Type': 'text/html' },
				});
			}

			return new Response(
				`<html>
			<body>
			  <h1>Todo List</h1>
			  <input type="text" id="todo-input" placeholder="Enter a new todo" />
			  <button id="add-todo">Add Todo</button>
			  <ul id="todo-list"></ul>
			  <br/><a href="/logout">Log out</a> | <a href="/profile">Go to Profile</a>
			  <script>
				const apiBase = '/api/todos';

				const cookie = document.cookie
					.split('; ')
					.find(row => row.startsWith('user_session'));
				console.log(cookie);
				const token = document.cookie.split('=')[1];
				if (!document.cookie) {
					alert('You are not logged in. Redirecting to login page.');
					window.location.href = '/login';
				}

  
				async function fetchTodos() {
				  const response = await fetch(apiBase, { headers: { Authorization: 'Bearer ' + token } });
				  const todos = await response.json();
				  const todoList = document.getElementById('todo-list');
				  todoList.innerHTML = '';
				  todos.forEach(todo => {
					const li = document.createElement('li');
					li.textContent = todo.text;
					todoList.appendChild(li);
				  });
				}
  
				document.getElementById('add-todo').addEventListener('click', async () => {
				  const input = document.getElementById('todo-input');
				  await fetch(apiBase, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
					body: JSON.stringify({ text: input.value }),
				  });
				  input.value = '';
				  fetchTodos();
				});
  
				fetchTodos();
			  </script>
			</body>
		  </html>`,
				{ headers: { 'Content-Type': 'text/html' } }
			);
		}

		// Logout
		if (path === '/logout') {
			const sessionId = getSessionId(request);
			if (sessionId) {
				await env.SESSIONS.delete(sessionId);
			}

			const headers = new Headers({
				'Set-Cookie': `${COOKIE_NAME}=; Path=/; Max-Age=0`,
				'Content-Type': 'text/html',
			});

			return new Response(`<html><body><h1>You have been logged out.</h1><a href="/login">Login again</a></body></html>`, { headers });
		}

		return new Response('Not found', { status: 404 });
	},
};

function getSessionId(request) {
	const cookieHeader = request.headers.get('Cookie');
	if (!cookieHeader) return null;
	try {
		const cookie = cookieHeader.split('; ').find((row) => row.startsWith('user_session'));
		return cookie ? cookie.split('=')[1] : null;
	} catch (e) {
		// 쿠키 여러개 없이 하나만 있을수도 있음.
		return cookieHeader.split('=')[1];
	}
	return null;
}
