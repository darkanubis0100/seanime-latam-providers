# Seanime LATAM Providers

Proveedores comunitarios en español para [Seanime](https://github.com/5rahim/seanime), orientados a usuarios de Latinoamérica.

> [!NOTE]
> Este proyecto es independiente y no forma parte del repositorio oficial de Seanime.

## Proveedores disponibles

| Proveedor | Tipo | Idioma | Versión | Estado |
| --- | --- | --- | --- | --- |
| AnimeFLV | Anime en línea | Español | 0.2.0 | Beta |
| JKAnime | Anime en línea | Español / Latino | 0.2.0 | Beta |
| ManhwaWeb | Manga y manhwa | Español | 0.1.0 | Beta |

## Instalación

En Seanime, abre **Extensions → Add extensions** y agrega el `manifest.json` correspondiente.

### AnimeFLV

```text
https://raw.githubusercontent.com/darkanubis0100/seanime-latam-providers/main/anime/animeflv/manifest.json
```

### JKAnime

```text
https://raw.githubusercontent.com/darkanubis0100/seanime-latam-providers/main/anime/jkanime/manifest.json
```

### ManhwaWeb

```text
https://raw.githubusercontent.com/darkanubis0100/seanime-latam-providers/main/manga/manhwaweb/manifest.json
```

Cada proveedor es independiente; puedes instalar solamente los que vayas a utilizar.

## Actualizar una instalación existente

Cuando cambie la versión del manifest, elimina y vuelve a agregar la extensión. Después limpia su caché o reinicia Seanime para evitar que quede cargado el payload anterior.

## Estructura

```text
anime/
├── animeflv/
│   ├── manifest.json
│   ├── provider-v2.ts   # payload activo
│   └── provider.ts      # primera beta / referencia
└── jkanime/
    ├── manifest.json
    ├── provider-v2.ts   # payload activo
    └── provider.ts      # primera beta / referencia

manga/
└── manhwaweb/
    ├── manifest.json
    └── provider.ts
```

## Cambios de la versión 0.2.0

- Timeouts explícitos para evitar que **Loading stream** quede girando indefinidamente.
- Mirrors sencillos y directos antes que reproductores fuertemente ofuscados.
- Headers separados para páginas HTML y archivos de vídeo.
- Decodificador Base64 propio para la lista de servidores de JKAnime.
- Mensajes de error y logs por mirror para facilitar el diagnóstico.

## Desarrollo

Para comprobar la sintaxis de los providers:

```bash
npm install
npm run check
```

## Estado del proyecto

Los proveedores están en fase beta. Las webs y sus reproductores externos pueden cambiar sus protecciones, dominios o estructura y requerir ajustes posteriores.

## Créditos

- [Seanime](https://github.com/5rahim/seanime), por el sistema de extensiones.
- [Yuzono / Aniyomi](https://github.com/yuzono/anime-extensions), como referencia para la lógica original de AnimeFLV y JKAnime.
- Proveedores adaptados y mantenidos por [Dark Anubis](https://github.com/darkanubis0100).
