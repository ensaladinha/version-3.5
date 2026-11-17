// Punto de entrada de Vercel: toda petición a /api/* llega acá (ver "rewrites" en vercel.json).
// La página (public/) la sirve la CDN de Vercel como archivos estáticos; en tu PC se usa `npm start`.
import app from '../server/server.js';
export default app;
