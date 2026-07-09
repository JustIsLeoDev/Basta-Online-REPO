const WebSocket = require('ws');

// Render asigna un puerto automáticamente en el entorno de producción a través de process.env.PORT
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

let godotHost = null;      // Guarda la conexión del servidor principal de Godot (Host)
let clientes = new Map();  // Guarda los sockets de los celulares conectados (Jugadores)

console.log(`Servidor orquestador de Basta corriendo en el puerto ${PORT}`);

// --- SISTEMA AUTOMÁTICO DE PING-PONG (Mantener vivo en Render) ---
// Revisa cada 30 segundos si las conexiones siguen activas para ganarle al timeout de Render
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log('Conexión inactiva detectada por timeout. Cerrando socket...');
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping(); // Envía un ping de control de baja capa de red
    });
}, 30000);

wss.on('connection', (ws) => {
    ws.isAlive = true;
    console.log('Nueva conexión de red establecida.');

    // Al recibir respuesta del ping (pong), marcamos la conexión como activa
    ws.on('pong', () => {
        ws.isAlive = true;
    });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                // 1. REGISTRO DEL HOST (GODOT)
                case 'register_host':
                    godotHost = ws;
                    console.log('¡Servidor Principal de Godot (Host) registrado!');
                    break;

                // 2. REGISTRO DEL JUGADOR (CELULAR / WEB)
                case 'register_player':
                    // BLINDAJE: Extrae el nombre sin importar si el cliente envía 'user', 'username' o 'name'
                    const nombreJugador = data.user || data.username || data.name;

                    // Validar que el nombre no sea null o una cadena inválida
                    if (!nombreJugador || nombreJugador === 'null' || nombreJugador === '<null>') {
                        console.error('⚠️ Registro rechazado: Cliente intentó unirse con un nombre vacío o nulo.', data);
                        break; 
                    }

                    // Guardar en el mapa de clientes activos
                    clientes.set(nombreJugador, ws);
                    console.log(`Jugador registrado legítimamente: ${nombreJugador}`);
                    
                    // Notificar al Host de Godot que alguien se unió con un formato limpio
                    if (godotHost && godotHost.readyState === WebSocket.OPEN) {
                        godotHost.send(JSON.stringify({ 
                            type: 'player_joined', 
                            username: nombreJugador 
                        }));
                    }
                    break;

                // 3. INICIO DE PARTIDA (REENVÍO DEL HOST A CELULARES)
                case 'start_game':
                    console.log(`¡El Host inició la partida! Reenviando letra [${data.letra}] y temas a los jugadores...`);
                    
                    clientes.forEach((clientSocket) => {
                        if (clientSocket.readyState === WebSocket.OPEN) {
                            clientSocket.send(JSON.stringify({
                                type: 'start_game',
                                letra: data.letra,
                                temas: data.temas
                            }));
                        }
                    });
                    break;

                // 4. RESPUESTAS DE UN JUGADOR (CELULAR A HOST)
                case 'player_answer':
                    const autorRespuestas = data.username || data.user;
                    console.log(`Respuestas recibidas de: ${autorRespuestas}. Enviando a Godot Host...`);
                    
                    if (godotHost && godotHost.readyState === WebSocket.OPEN) {
                        godotHost.send(JSON.stringify({
                            type: 'player_answer',
                            username: autorRespuestas,
                            answers: data.answers
                        }));
                    }
                    break;

                // 5. ENVÍO DE RESULTADOS (HOST A CELULARES)
                case 'game_results':
                    console.log('¡Resultados calculados recibidos del Host! Distribuyendo a todos los jugadores...');
                    
                    clientes.forEach((clientSocket) => {
                        if (clientSocket.readyState === WebSocket.OPEN) {
                            clientSocket.send(JSON.stringify({
                                type: 'game_results',
                                puntajes_ronda: data.puntajes_ronda || {},
                                puntajes_globales: data.puntajes_globales || {}
                            }));
                        }
                    });
                    break;

                // 6. CONTROL DE PING MANUAL DESDE CLIENTES
                case 'ping':
                    // Algunos navegadores o clientes móviles envían un JSON de ping manual para evitar reposo
                    ws.isAlive = true;
                    break;
            }
        } catch (e) {
            console.error('Error al procesar el JSON recibido:', e);
        }
    });

    // --- MANEJO DE DESCONEXIONES ---
    ws.on('close', () => {
        if (ws === godotHost) {
            console.log('🛑 El servidor central de Godot (Host) se ha desconectado.');
            godotHost = null;
        } else {
            // Buscar cuál jugador se desconectó basándose en su socket
            for (let [user, socket] of clientes.entries()) {
                if (socket === ws) {
                    clientes.delete(user);
                    console.log(`❌ Jugador fuera de línea: ${user}`);
                    
                    // Avisarle al Host de Godot en tiempo real para limpiar la lista en pantalla
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
