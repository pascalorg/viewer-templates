# Pascal viewer templates

Starting points for building your own viewer of [Pascal](https://editor.pascal.app) projects. Each folder is a complete, standalone app: fork it, change the lighting, the post stack or the interface, and deploy it anywhere. None of them needs Pascal's editor packages.

| Template | What it shows | Source |
| --- | --- | --- |
| [`listing`](listing) | A published project's 3D file, with floors, room names and areas, and doors and windows that open | Baked 3D file |
| [`pascal`](pascal) | Pascal's hosted viewer: header, controls bar, 3D and 2D views, rooms, walkthrough and sounds | Baked 3D file with live parts, or a live rebuild |

Every template reads Pascal's public read, `GET https://editor.pascal.app/api/projects/{id}/scene`. It answers a project's published revision with the scene graph, its materials and short-lived links to the baked 3D file. Public projects need no key.

## Start from a template

```bash
npx degit pascalorg/viewer-templates/listing my-viewer
cd my-viewer
npm install
npm run dev
# open http://localhost:5173/?project=<published project id>
```

Replace `listing` with `pascal` to start from the hosted viewer instead.

Or deploy a copy straight away:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fpascalorg%2Fviewer-templates%2Ftree%2Fmain%2Flisting&project-name=pascal-viewer&env=VITE_PASCAL_PROJECT_ID&envDescription=The%20id%20of%20a%20published%20Pascal%20project)

Or host the build on Pascal at `https://<slug>.pascal-viewer.app`: see [Deploy to Pascal](listing/README.md#deploy-to-pascal).

Each template's `AGENTS.md` explains the read, what the 3D file contains and how to customise it, for you and for your coding agent.

## Rules every template follows

- Never put a Pascal API key in the browser. Private projects need a server you control.
- Signed 3D file links last ten minutes; read the scene again to renew them.
- A template must build, typecheck and pass its smoke test in CI.

## License

MIT
