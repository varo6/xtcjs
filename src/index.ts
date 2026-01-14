// Bun server with HTML imports
// All conversion happens client-side - this just serves the files

import index from "./index.html";

const server = Bun.serve({
  port: 3000,
  routes: {
    "/": index,
  },
  development: {
    hmr: true,
    console: true,
  },
});

console.log(`
╔═══════════════════════════════════════════════════════════╗
║         CBZ to XTC Converter - Frontend Server            ║
╠═══════════════════════════════════════════════════════════╣
║  Server running at: http://localhost:${server.port}                 ║
║                                                           ║
║  All conversion happens in your browser!                  ║
║  No files are uploaded to any server.                     ║
╚═══════════════════════════════════════════════════════════╝
`);
