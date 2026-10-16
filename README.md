# Panel Creality

Panel web no oficial para controlar y vigilar una impresora Creality con Klipper desde el navegador, en el ordenador o en el móvil. Está pensado para la K1 SE con CFS, pero detecta al conectar qué tiene la impresora (CFS, cortador, luz, sensor de filamento, sensores de temperatura) y oculta lo que no aplica.

No necesita instalación ni compilación: son archivos HTML, CSS y JavaScript que se abren directamente en el navegador.

![Vista general del panel](docs/img/general.png)

## Funciones

- **Trabajo actual:** progreso, capa, tiempo transcurrido y restante, hora estimada de fin, filamento consumido frente al total y peso actual frente al peso final de la pieza, y miniatura del modelo. Pausar, reanudar y cancelar.
- **Cámara:** vídeo en directo por WebRTC (la cámara de Creality) o por una URL MJPEG, con captura de imagen, pantalla completa y botón de luz.
- **Control:** temperaturas de boquilla y cama con preajustes para PLA, PETG y ABS, gráfica de los últimos 10 minutos, velocidad, flujo, ventilador, ajuste fino del offset Z, movimiento de ejes, home y extrusión manual.
- **Parada de emergencia:** hay que pulsarla dos veces en 3 segundos, para que un toque accidental no detenga una impresión. Si Klipper se cae, aparece un aviso con botones para reiniciar el firmware, Klipper o el servicio.
- **CFS:** estado de las cuatro ranuras (material, color y restante con RFID), carga y descarga de filamento, edición de material y color, recorrido del filamento, temperatura y humedad del CFS, y sus opciones (recarga automática, cambio automático de ranura, precarga).
- **Nivelación:** mapa de color de la malla de la cama con el punto más bajo, el más alto y la diferencia total.
- **Archivos:** lista de G-code con miniatura, tiempo, peso y material, búsqueda, subida por arrastrar y soltar, con opción de imprimir al terminar de subir.
- **Timelapses:** reproducción y descarga de los vídeos que graba la impresora.
- **Estadísticas:** horas de impresión, trabajos, tasa de éxito, filamento usado y coste estimado, horas por día de los últimos 30 días, consumo por material y colores más usados.
- **Mantenimiento:** tareas con aviso por horas de impresión, días o cortes del CFS. Se guardan en la impresora, así que se comparten entre dispositivos.
- **Consola:** envío de G-code con historial de comandos (flechas arriba y abajo).
- **Historial:** últimos trabajos con su estado, y botón para volver a imprimir.
- **Avisos:** al terminar, al fallar o cancelarse, al pausarse o agotarse el filamento, cuando faltan 10 minutos y cuando una temperatura llega a su objetivo. Llegan como aviso del navegador con sonido y, opcionalmente, al móvil por ntfy o Telegram, con una foto de la cámara adjunta.

## Capturas

### Control

![Pestaña Control](docs/img/control.png)

### CFS

![Pestaña CFS](docs/img/cfs.png)

### Nivelación

![Pestaña Nivelación](docs/img/nivelacion.png)

### Archivos

![Pestaña Archivos](docs/img/archivos.png)

### Estadísticas y mantenimiento

![Pestaña Estadísticas](docs/img/estadisticas.png)

### Historial

![Pestaña Historial](docs/img/historial.png)

### Ajustes

![Ventana de ajustes](docs/img/ajustes.png)

### En el móvil

<img src="docs/img/movil.png" alt="Panel en el móvil" width="320">

Las capturas están hechas con datos de una impresora simulada y con la cámara desactivada. Con la impresora real, el recuadro negro muestra el vídeo en directo.

## Requisitos

- Una impresora Creality con Klipper y Moonraker accesibles en la red local.
- Un navegador actual (Chrome, Edge, Firefox o Safari).

Puertos que usa el panel (se pueden cambiar en Ajustes, en "Puertos avanzados"):

| Servicio | Puerto | Para qué |
| --- | --- | --- |
| Moonraker | 7125 | Estado, control, archivos, historial y estadísticas |
| Cámara WebRTC de Creality | 8000 | Vídeo en directo |
| WebSocket de Creality | 9999 | Lista de timelapses |
| Web de la impresora | 80 | Descarga de los vídeos de timelapse |

## Uso

### Abrirlo como archivo

1. Abre `index.html` en el navegador (doble clic).
2. La primera vez se abre la ventana de ajustes: escribe la IP de la impresora y guarda.
3. Con "Probar conexión" puedes comprobar qué servicios responden.

Los ajustes se guardan en el navegador, así que hay que configurarlos una vez en cada dispositivo.

### Servirlo desde un servidor

Si el panel lo sirve un servidor web, se conecta a la impresora a través de él usando las rutas `/printer-api`, `/printer-cam`, `/printer-ws` y `/printer-web`. En este modo la IP y los puertos se configuran en el servidor y no en Ajustes. Ejemplo de configuración para nginx (cambia `IP_DE_LA_IMPRESORA` por la IP de tu impresora y `root` por la carpeta donde copies el panel):

```nginx
server {
    listen 80;
    server_name _;

    root /var/www/panel_creality;
    index index.html;

    location /printer-api/ {
        proxy_pass http://IP_DE_LA_IMPRESORA:7125/;
        client_max_body_size 1g;
    }

    location /printer-cam/ {
        proxy_pass http://IP_DE_LA_IMPRESORA:8000/;
    }

    location /printer-web/ {
        proxy_pass http://IP_DE_LA_IMPRESORA:80/;
    }

    location = /printer-ws {
        proxy_pass http://IP_DE_LA_IMPRESORA:9999/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Hay que copiar al servidor la carpeta completa (`index.html`, `css/`, `js/` e `img/`). La carpeta `docs/` solo la usa este README.

El panel no tiene usuario ni contraseña: cualquiera que pueda abrirlo puede controlar la impresora. No lo publiques en internet sin protección. Para usarlo fuera de casa es mejor una VPN como Tailscale.

## Avisos

- Los avisos los genera el propio panel, así que tiene que estar abierto en algún dispositivo para que lleguen.
- Los avisos del navegador se activan con el botón de la campana. Funcionan al abrir el panel como archivo, en `localhost` o por `https://`. Por `http://` a una IP o dominio el navegador los bloquea.
- Para recibirlos en el móvil aunque el navegador esté cerrado, configura en Ajustes, en la sección "Avisos", un tema de [ntfy](https://ntfy.sh) o un bot de Telegram (token y chat ID). Hazlo en un solo navegador para no recibir avisos duplicados.
- "Enviar aviso de prueba" comprueba la configuración sin esperar a una impresión.

## Dónde se guardan los datos

- **Ajustes del panel:** en el navegador (`localStorage`).
- **Precio del filamento y tareas de mantenimiento:** en la base de datos de Moonraker, en el espacio `crpanel`, para que todos los dispositivos vean lo mismo. Si no se puede escribir ahí, se guardan en el navegador y el panel lo indica.
- **Historial y estadísticas:** se leen del historial de Moonraker; el panel no guarda copia.

## Estructura del proyecto

```
Creality-Panel/
├── index.html        Estructura de la página
├── css/
│   └── panel.css     Estilos
├── img/
│   └── logo.png      Logo de la cabecera
├── js/
│   ├── core.js       Ajustes, conexión con Moonraker, detección del hardware y utilidades
│   ├── status.js     Lectura periódica del estado y tarjeta del trabajo actual
│   ├── control.js    Gráfica de temperaturas, controles, extrusión y parada de emergencia
│   ├── cfs.js        Ranuras y opciones del CFS
│   ├── files.js      Lista y subida de archivos
│   ├── stats.js      Estadísticas, mantenimiento y base de datos compartida
│   ├── tabs.js       Nivelación, timelapses, consola, historial, pestañas y vista ampliada
│   ├── notify.js     Detección de eventos y envío de avisos
│   ├── camera.js     Cámara WebRTC y MJPEG, captura de imagen
│   └── main.js       Ventana de ajustes y arranque del panel
└── docs/
    └── img/          Capturas de este README
```

Los scripts son JavaScript normal (no módulos), cargados en ese orden desde `index.html` y compartiendo variables globales. Por eso el panel funciona también abierto como archivo, donde los navegadores no permiten módulos.

### Publicar cambios

`index.html` carga el CSS y los scripts con un número de versión al final (`?v=3`). Al cambiar cualquiera de ellos, sube ese número en todas las etiquetas para que los navegadores no sigan usando la versión guardada en caché.
