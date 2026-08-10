const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = Number(process.env.PORT || 8173);
const mime = {
  '.html':'text/html; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.svg':'image/svg+xml', '.webp':'image/webp',
  '.mp3':'audio/mpeg', '.wav':'audio/wav', '.mp4':'video/mp4'
};

http.createServer((req,res)=>{
  const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(root,relative);
  if(file !== root && !file.startsWith(root + path.sep)){
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.stat(file,(statError,stat)=>{
    if(statError || !stat.isFile()){
      res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});
      res.end('Not found'); return;
    }
    res.writeHead(200,{
      'Content-Type':mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control':'no-store'
    });
    fs.createReadStream(file).pipe(res);
  });
}).listen(port,()=>console.log(`Zhaojian standalone demo: http://localhost:${port}/`));
