FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# Dependencias primero para aprovechar la caché de capas
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY publico ./publico
COPY servidor ./servidor
COPY herramientas ./herramientas
COPY base_de_datos ./base_de_datos
COPY datos ./datos

# Carpetas con escritura: modelo entrenado y fotos de productos y portada del login (se montan como volúmenes para conservarlas)
RUN mkdir -p /app/modelos /app/publico/imagenes/productos /app/publico/imagenes/portada && chown -R node:node /app/modelos /app/publico/imagenes/productos /app/publico/imagenes/portada
ENV MODEL_DIR=/app/modelos

USER node
EXPOSE 3000
CMD ["node", "servidor/servidor.js"]
