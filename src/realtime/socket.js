import { Server as SocketIOServer } from 'socket.io'

export function createSocketServer(httpServer, { corsOrigin }) {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: corsOrigin || true,
      credentials: true,
    },
  })

  io.on('connection', (socket) => {
    socket.emit('server:ready', { ok: true, ts: Date.now() })
  })

  return io
}

