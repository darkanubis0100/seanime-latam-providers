# Seanime LATAM Providers

Proveedores comunitarios en español para [Seanime](https://github.com/5rahim/seanime), orientados a usuarios de Latinoamérica.

> [!NOTE]
> Este proyecto es independiente y no forma parte del repositorio oficial de Seanime.

## Proveedores disponibles

| Proveedor | Tipo | Idioma | Estado |
| --- | --- | --- | --- |
| AnimeFLV | Anime en línea | Español | Beta |
| JKAnime | Anime en línea | Español / Latino | Beta |
| ManhwaWeb | Manga y manhwa | Español | Beta |

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

## Estructura

```text
anime/
├── animeflv/
│   ├── manifest.json
│   └── provider.ts
└── jkanime/
    ├── manifest.json
    └── provider.ts

manga/
└── manhwaweb/
    ├── manifest.json
    └── provider.ts
```

## Desarrollo

Para comprobar la sintaxis de los providers:

```bash
npm install
npm run check
```

## Estado del proyecto

Los proveedores están en fase beta. La búsqueda, los episodios, los capítulos y las páginas fueron portados; los reproductores externos pueden cambiar sus protecciones o dominios y requerir ajustes posteriores.

## Créditos

- [Seanime](https://github.com/5rahim/seanime), por el sistema de extensiones.
- [Yuzono / Aniyomi](https://github.com/yuzono/anime-extensions), como referencia para la lógica original de AnimeFLV y JKAnime.
- Proveedores adaptados y mantenidos por [Dark Anubis](https://github.com/darkanubis0100).
