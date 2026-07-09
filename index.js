const WebSocket = require('ws');

// Render asigna un puerto automáticamente en el entorno de producción
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

let godotHost = null; // Guardará la conexión del servidor principal de Godot
let clientes = new Map(); // Guardará a los jugadores conectados

console.log(`Servidor orquestador corriendo en el puerto ${PORT}`);

wss.on('connection', (ws) => {
    console.log('Nueva conexión de red establecida.');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'register_host':
                    // El Godot principal se identifica como el HOST
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

                case 'submit_round':
                    // REPASTE: El cliente manda sus respuestas validadas y se las arrojamos a Godot
                    console.log(`Respuestas recibidas de ${data.player}. Repasteando a Godot...`);
                    if (godotHost && godotHost.readyState === WebSocket.OPEN) {
                        godotHost.send(JSON.stringify({
                            type: 'player_answer',
                            username: data.player,
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
            // Buscar y limpiar el cliente desconectado
            for (let [user, socket] of clientes.entries()) {
                if (socket === ws) {
                    clientes.delete(user);
                    console.log(`Jugador desconectado: ${user}`);
                    break;
                }
            }
        }
    });
});
