# TaskMaster Pro — Ultimate Todo & Productivity Suite

> A full-featured todo and productivity app built on **Cloudflare Workers**, using a **Durable Object** with an embedded SQLite database for persistent, per-user state and a **Hono** REST API.

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=flat-square&logo=cloudflare&logoColor=white)
![Hono](https://img.shields.io/badge/Hono-4.6-000000?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-ESM-3178C6?style=flat-square&logo=typescript&logoColor=white)
![SQLite](https://img.shields.io/badge/Storage-SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white)

## ✨ Features

- **Todos** — create, update, complete, and delete tasks
- **Priorities** — filter tasks by priority level
- **Tags & lists** — organise tasks into lists and tag them freely
- **Pinning** — pin important tasks so they sort to the top
- **Due dates** — tasks sort by due date ahead of creation date
- **Search** — full-text search across titles and descriptions
- **Stats dashboard** — aggregated productivity stats at a glance

## 🗂 Project Structure

```
.
├── public/
│   ├── index.html      # Front-end SPA (served as static assets)
│   └── style.css
├── src/
│   └── index.ts        # Durable Object + Hono REST API
├── package.json
└── wrangler.json       # Cloudflare Workers configuration
```

## 🚀 Run Locally

```bash
npm install
npx wrangler dev
```

Wrangler serves the static assets from `public/` and runs the Durable Object API in-process.

## 🔌 API

All routes are handled inside the `App` Durable Object.

| Method | Route                  | Description                                   |
| ------ | ---------------------- | --------------------------------------------- |
| GET    | `/api/todos`           | List todos (filters: `status`, `priority`, `search`, `tag`, `listId`) |
| POST   | `/api/todos`           | Create a todo                                  |
| PATCH  | `/api/todos/:id`       | Update a todo                                  |
| DELETE | `/api/todos/:id`       | Delete a todo                                  |
| GET    | `/api/lists`           | List all lists                                 |
| POST   | `/api/lists`           | Create a list                                  |
| DELETE | `/api/lists/:id`       | Delete a list                                  |
| GET    | `/api/stats`           | Aggregated stats                               |

Todos are returned sorted by `is_pinned DESC, due_date ASC, created_at DESC`.

## ☁️ Deploy

```bash
npx wrangler deploy
```

## 📄 License

MIT
