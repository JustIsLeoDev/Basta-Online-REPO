const WebSocket = require('ws');

// Render asigna un puerto automáticamente en el entorno de producción
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

let godotHost = null; // Guardará la conexión del servidor principal de Godot
let clientes = new Map(); // Guardará a los jugadores conectados

console.log(`Servidor orquestador corriendo en el puerto ${PORT}`);

// --- SISTEMA ANTIDESCONEXIÓN (PING-PONG) ---
// Revisa cada 30 segundos si las conexiones siguen vivas para ganarle al timeout de Render
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log('Conexión inactiva detectada. Terminando socket...');
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping(); // Envía un ping de control (baja capa de red)
    });
}, 30000);

wss.on('connection', (ws) => {
    ws.isAlive = true;
    console.log('Nueva conexión de red establecida.');

    // Al recibir respuesta del ping, marcamos como vivo
    ws.on('pong', () => {
        ws.isAlive = true;
    });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'register_host':
                    godotHost = ws;
                    console.log('¡Servidor Principal de Godot (Host) registrado!');
                    break;

                case 'register_player':
                    // Un celular se registra con su nombre de usuario
                    clientes.set(data.user, ws);
                    console.log(`Jugador registrado: ${data.user}`);
                    
                    // Notificar al Host de Godot que alguien se unió
                    if (godotHost && godotHost.readyState === WebSocket.OPEN) {
                        godotHost.send(JSON.stringify({ type: 'player_joined', username: data.user }));
                    }
                    break;

                case 'start_game':
                    console.log(`¡El Host inició la partida! Reenviando letra [${data.letra}] y temas...`);
                    
                    clientes.forEach((clientSocket, username) => {
                        if (clientSocket.readyState === WebSocket.OPEN) {
                            clientSocket.send(JSON.stringify({
                                type: 'start_game',
                                letra: data.letra,
                                temas: data.temas
                            }));
                        }
                    });
                    break;

                case 'player_answer':
                    console.log(`Respuestas recibidas de ${data.username}. Repasteando a Godot Host...`);
                    if (godotHost && godotHost.readyState === WebSocket.OPEN) {
                        godotHost.send(JSON.stringify({
                            type: 'player_answer',
                            username: data.username,
                            answers: data.answers
                        }));
                    }
                    break;
            }
        } catch (e) {
            console.error('Error al procesar JSON:', e);
        }
    });

    ws.on('close', () => {
        if (ws === godotHost) {
            console.log('El servidor central de Godot se ha desconectado.');
            godotHost = null;
        } else {
            // Buscar, limpiar y avisar a Godot de la baja del jugador
            for (let [user, socket] of clientes.entries()) {
                if (socket === ws) {
                    clientes.delete(user);
                    console.log(`Jugador desconectado de Node.js: ${user}`);
                    
                    // 🔥 CRÍTICO: Avisarle al Host de Godot para que lo borre de su lista_jugadores
                    if (godotHost && godotHost.readyState === WebSocket.OPEN) {
                        godotHost.send(JSON.stringify({ 
                            type: 'player_left', 
                            username: user 
                        }));
                    }
                    break;
                }
            }
        }
    });
});

wss.on('close', () => {
    clearInterval(interval);
});
