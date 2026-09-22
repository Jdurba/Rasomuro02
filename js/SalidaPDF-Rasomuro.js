// ════════════════════════════════════════════════════════════════
//  SalidaPDF-Rasomuro.js — Generador de PDF para Rasomuro KIT
//  Estrategia: jsPDF nativo, datos desde estado (no DOM).
//  Página 1: réplica de Form2 (datos + códigos + imgCombo con cotas).
//  Páginas 2+ : pendientes de definir.
//
//  Carga:
//    <script src="../General/jspdf_umd_min.js"></script>
//    <script src="SalidaPDF-Rasomuro.js"></script>
//
//  Uso desde el HTML (btnPDF):
//    SalidaPDFRasomuro.generar(config);
// ════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // ── DIMENSIONES A4 (mm) ────────────────────────────────────────
  const W = 210;
  const H = 297;
  const M = 15;                     // margen
  const CW = W - 2 * M;             // ancho útil 180
  const CH = H - 2 * M;             // alto útil 267

  // ── PALETA (heredada del ecosistema) ───────────────────────────
  const COLOR_AZUL   = [26, 43, 111];     // #1a2b6f
  const COLOR_TEXTO  = [33, 33, 33];      // #212121
  const COLOR_LABEL  = [85, 85, 85];      // #555
  const COLOR_LINEA  = [153, 153, 153];   // #999
  const COLOR_FRANJA = [232, 232, 232];   // #e8e8e8

  // ── RUTAS DE RECURSOS ──────────────────────────────────────────
  const LOGO_URL = 'https://jdurba.github.io/General/img/LOGO_2025_Negro.svg';

  // ── CACHÉ DE IMÁGENES ──────────────────────────────────────────
  const cacheImg = new Map();

  function cargarImagen(url) {
    if (cacheImg.has(url)) return cacheImg.get(url);
    const esSVG = /\.svg(\?|$)/i.test(url);
    const p = esSVG ? cargarSVG(url) : cargarBitmap(url);
    cacheImg.set(url, p);
    return p;
  }

  function cargarBitmap(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        try {
          resolve({ dataUrl: c.toDataURL('image/png'),
                    w: img.naturalWidth, h: img.naturalHeight });
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  async function cargarSVG(url) {
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      let txt = await r.text();
      // Extraer dimensiones del viewBox
      let vbW = 100, vbH = 100;
      const m = txt.match(/viewBox\s*=\s*["']([^"']+)["']/i);
      if (m) {
        const p = m[1].trim().split(/[\s,]+/).map(Number);
        if (p.length === 4) { vbW = p[2]; vbH = p[3]; }
      }
      // Rasterizar SVG a PNG vía canvas.
      // Escala calculada para impresión a ~300 dpi sobre el alto real
      // que ocupará en el PDF, no sobre el viewBox del SVG.
      // Logo: 14 mm → ~165 px @300 dpi. Margen ×2 para nitidez.
      const altoObjetivoPx = 330;
      const escala = altoObjetivoPx / vbH;
      const blob = new Blob([txt], { type: 'image/svg+xml;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      return await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width  = vbW * escala;
          c.height = vbH * escala;
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(blobUrl);
          resolve({ dataUrl: c.toDataURL('image/png'), w: vbW, h: vbH });
        };
        img.onerror = () => { URL.revokeObjectURL(blobUrl); resolve(null); };
        img.src = blobUrl;
      });
    } catch { return null; }
  }

  // Espejo horizontal de una imagen ya cargada (devuelve mismo formato)
  function flipHorizontal(img) {
    return new Promise((resolve) => {
      const i = new Image();
      i.onload = () => {
        const c = document.createElement('canvas');
        c.width = i.naturalWidth;
        c.height = i.naturalHeight;
        const ctx = c.getContext('2d');
        ctx.translate(c.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(i, 0, 0);
        resolve({ dataUrl: c.toDataURL('image/png'), w: img.w, h: img.h });
      };
      i.onerror = () => resolve(img);
      i.src = img.dataUrl;
    });
  }

  // Recorta píxeles blancos/transparentes de los bordes de una imagen.
  // Devuelve mismo formato {dataUrl, w, h} con dimensiones ya recortadas.
  // umbral: 0-255, los píxeles más claros que esto se consideran "fondo" (def. 245)
  function recortarMargenes(img, umbral = 245) {
    return new Promise((resolve) => {
      const i = new Image();
      i.onload = () => {
        const W = i.naturalWidth, H = i.naturalHeight;
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const ctx = c.getContext('2d');
        ctx.drawImage(i, 0, 0);
        const data = ctx.getImageData(0, 0, W, H).data;

        // Función: ¿el píxel (x,y) es contenido (no fondo)?
        const esContenido = (x, y) => {
          const idx = (y * W + x) * 4;
          const a = data[idx + 3];
          if (a < 20) return false;              // transparente
          const r = data[idx], g = data[idx+1], b = data[idx+2];
          return !(r >= umbral && g >= umbral && b >= umbral); // no es casi-blanco
        };

        // Escanear bordes
        let top = 0, bottom = H - 1, left = 0, right = W - 1;
        outer1: for (; top < H; top++)
          for (let x = 0; x < W; x++) if (esContenido(x, top)) break outer1;
        outer2: for (; bottom >= top; bottom--)
          for (let x = 0; x < W; x++) if (esContenido(x, bottom)) break outer2;
        outer3: for (; left < W; left++)
          for (let y = top; y <= bottom; y++) if (esContenido(left, y)) break outer3;
        outer4: for (; right >= left; right--)
          for (let y = top; y <= bottom; y++) if (esContenido(right, y)) break outer4;

        // Si no se ha encontrado contenido, devolver original
        if (top > bottom || left > right) { resolve(img); return; }

        const nW = right - left + 1, nH = bottom - top + 1;
        const c2 = document.createElement('canvas');
        c2.width = nW; c2.height = nH;
        c2.getContext('2d').drawImage(i, left, top, nW, nH, 0, 0, nW, nH);
        resolve({ dataUrl: c2.toDataURL('image/png'), w: nW, h: nH });
      };
      i.onerror = () => resolve(img);
      i.src = img.dataUrl;
    });
  }

  // ── HELPERS DE DIBUJO ──────────────────────────────────────────
  function setFill(doc, c)   { doc.setFillColor(c[0], c[1], c[2]); }
  function setText(doc, c)   { doc.setTextColor(c[0], c[1], c[2]); }
  function setDraw(doc, c)   { doc.setDrawColor(c[0], c[1], c[2]); }

  // Cabecera: logo izq + título der + línea separadora
  async function dibujarCabecera(doc) {
    const yLogo = M;
    const altoLogo = 14;
    const logo = await cargarImagen(LOGO_URL);
    if (logo) {
      const anchoLogo = altoLogo * (logo.w / logo.h);
      doc.addImage(logo.dataUrl, 'PNG', M, yLogo, anchoLogo, altoLogo);
    }
    // Título a la derecha
    setText(doc, COLOR_AZUL);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('RASOMURO KIT — Instrucciones de montaje', W - M, yLogo + altoLogo - 4, { align: 'right' });

    // Línea separadora
    setDraw(doc, COLOR_AZUL);
    doc.setLineWidth(0.4);
    doc.line(M, yLogo + altoLogo + 3, W - M, yLogo + altoLogo + 3);

    return yLogo + altoLogo + 8; // Y siguiente disponible
  }

  // Pie: Pág X/N + fecha
  function dibujarPie(doc, paginaActual, totalPaginas, fecha) {
    const y = H - 8;
    setText(doc, COLOR_LABEL);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(fecha, M, y);
    doc.text(`Pág ${paginaActual} / ${totalPaginas}`, W - M, y, { align: 'right' });
  }

  // Bloque-titulo estilo ecosistema: franja gris con texto azul
  function dibujarBloqueTitulo(doc, x, y, ancho, texto) {
    const alto = 7;
    setFill(doc, COLOR_FRANJA);
    doc.rect(x, y, ancho, alto, 'F');
    // Franja lateral azul
    setFill(doc, COLOR_AZUL);
    doc.rect(x, y, 1.2, alto, 'F');
    setText(doc, COLOR_AZUL);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(texto, x + 4, y + alto - 2);
    return y + alto + 3;
  }

  // ── PÁGINA 1: Resumen de Form2 (layout 2×2) ────────────────────
  async function dibujarPagina1(doc, config) {
    // Recursos del estado
    const r = window.generarResumen(config);
    const cotas = window.calcularCotas(config, r);
    const combo = (r.altoKit >= 2500) ? 'combo04' : 'combo03';
    const pos = window.COTAS_POS[combo][config.apertura];

    const LABEL_TIPO   = window.LABEL_TIPO;
    const LABEL_CIERRE = window.LABEL_CIERRE;
    const LABEL_ACAB   = window.LABEL_ACAB;
    const LABEL_APERT  = window.LABEL_APERT;

    let y = await dibujarCabecera(doc);

    // ── Layout 2×2 ─────────────────────────────────────────────
    const GAP = 5;
    const colW = (CW - GAP) / 2;
    const colIzqX  = M;
    const colDchaX = M + colW + GAP;

    const altoUtil = (H - M - 5) - y;         // alto disponible hasta el pie
    const rowH = (altoUtil - GAP) / 2;
    const rowSupY = y;
    const rowInfY = y + rowH + GAP;

    // ═══ BLOQUE 1 (sup-izq): Parámetros + Códigos ═════════════
    let yIzq = dibujarBloqueTitulo(doc, colIzqX, rowSupY, colW, 'Parámetros seleccionados');

    const datos = [
      ['Alto luz obra',   `${config.alturaLuzObra} mm`],
      ['Ancho luz obra',  `${config.anchoLuzObra} mm`],
      ['Kit aplicado',    `${r.altoKit} mm`],
      ['Tipo cabecero',   LABEL_TIPO[config.tipoRasomuro]],
      ['Alto puerta',     `${config.alturaPuerta} mm`],
      ['Ancho puerta',    `${config.anchoPuerta} mm`],
      ['Apertura',        LABEL_APERT[config.apertura]],
      ['Acabado herraje', LABEL_ACAB[config.acabado]],
      ['Modelo cierre',   LABEL_CIERRE[config.cierre]],
      ['Cantidad',        `${config.cantidadPuertas} ud.`]
    ];

    doc.setFontSize(9);
    datos.forEach(([etiq, valor]) => {
      setText(doc, COLOR_LABEL);
      doc.setFont('helvetica', 'normal');
      doc.text(etiq, colIzqX + 2, yIzq);
      setText(doc, COLOR_TEXTO);
      doc.setFont('helvetica', 'bold');
      doc.text(valor, colIzqX + colW - 2, yIzq, { align: 'right' });
      yIzq += 5;
    });
    yIzq += 3;

    yIzq = dibujarBloqueTitulo(doc, colIzqX, yIzq, colW, 'Códigos para el pedido');
    doc.setFontSize(8.5);
    r.codigos.forEach(l => {
      setText(doc, COLOR_TEXTO);
      doc.setFont('helvetica', 'bold');
      doc.text(`${l.cant}×`, colIzqX + 2, yIzq);
      doc.text(l.code, colIzqX + 10, yIzq);
      setText(doc, COLOR_LABEL);
      doc.setFont('helvetica', 'normal');
      const desc = doc.splitTextToSize(l.desc, colW - 4);
      doc.text(desc, colIzqX + 2, yIzq + 4);
      yIzq += 4 + (desc.length * 3.5) + 2;
    });

    // ═══ BLOQUE 2 (sup-dcha): imgCombo con cotas ══════════════
    await dibujarBloqueImgCombo(doc, colDchaX, rowSupY, colW, rowH, r, cotas, pos, config);

    // ═══ BLOQUE 3 (inf-izq): imgKit con título ════════════════
    const tituloB3 = `Perfiles verticales incluidos en el Kit ${r.altoKit}`;
    const yB3 = dibujarBloqueTitulo(doc, colIzqX, rowInfY, colW, tituloB3);
    await dibujarBloqueImagen(doc, colIzqX, yB3, colW, rowH - (yB3 - rowInfY), r.imgKit);

    // ═══ BLOQUE 4 (inf-dcha): Paso 1 con cortes ════════════════
    const yB4 = dibujarBloqueTitulo(doc, colDchaX, rowInfY, colW, 'Paso 1 — Cortes del perfil de bisagras');
    const MedPerfil    = r.altoKit + 10;
    const MedAuxPuerta = config.alturaPuerta + 10;
    const Corte1 = (MedPerfil + MedAuxPuerta) / 2;
    const Corte2 = MedAuxPuerta;
    const yPieMax = H - 12;                          // límite superior del pie (deja 4mm sobre el texto)
    await dibujarBloquePaso1(
      doc, colDchaX, yB4, colW, yPieMax - yB4,
      { Corte1, Corte2 }
    );
  }

  // Dibuja imgCombo + cotas dentro de un recuadro (x,y,w,h)
  async function dibujarBloqueImgCombo(doc, x, y, w, h, r, cotas, pos, config) {
    let imgCombo = await cargarImagen(r.imgCombo);
    if (imgCombo && config.apertura === 'izquierda') {
      imgCombo = await flipHorizontal(imgCombo);
    }
    if (!imgCombo) return;

    const ratio = imgCombo.w / imgCombo.h;
    let iw = w, ih = w / ratio;
    if (ih > h) { ih = h; iw = h * ratio; }
    const ix = x + (w - iw) / 2;
    const iy = y + (h - ih) / 2;

    doc.addImage(imgCombo.dataUrl, 'PNG', ix, iy, iw, ih);

    setText(doc, COLOR_AZUL);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    Object.entries(pos).forEach(([id, p]) => {
      const valor = cotas[id];
      if (valor === undefined || valor === 0) return;
      const cx = ix + (parseFloat(p.left) / 100) * iw;
      const cy = iy + (parseFloat(p.top)  / 100) * ih;
      doc.text(String(valor), cx, cy + 1, { align: 'center' });
    });
  }

  // Dibuja una imagen centrada dentro de un recuadro (x,y,w,h)
  async function dibujarBloqueImagen(doc, x, y, w, h, url) {
    const img = await cargarImagen(url);
    if (!img) return;
    const ratio = img.w / img.h;
    let iw = w, ih = w / ratio;
    if (ih > h) { ih = h; iw = h * ratio; }
    const ix = x + (w - iw) / 2;
    const iy = y + (h - ih) / 2;
    doc.addImage(img.dataUrl, 'PNG', ix, iy, iw, ih);
  }

  // ── BLOQUE 4: Paso 1 (CortePerfilBis03 + 5 textos superpuestos) ──
  // Posiciones de cada texto en % sobre la imagen.
  // AJUSTAR AQUÍ visualmente hasta cuadrar; mismo sistema que COTAS_POS.


  const PASO1_POS = {
    Corte1: { top: '50%', left: '62%', size: 7,  bold: true,  color: 'azul', align: 'center' },
    Corte2: { top: '48%', left: '38.5%', size: 7,  bold: true,  color: 'azul', align: 'center' },
    Texto1: { top: '90%', left: '72%', size: 6.5,  bold: true,  color: 'texto', align: 'left' },
    Texto2: { top: '10%', left: '80%', size: 6.5,bold: false, color: 'texto', align: 'left' },
    Texto3: { top: '74%', left: '1%', size: 6.5,bold: false, color: 'texto', align: 'left' },
  };

  const TEXTOS_PASO1 = {
    Texto1: '¡IMPORTANTE!\nPrestar atención a la posición\ndel perfil,en este caso \nes reversible',
    Texto2: 'Corte 1\nmedido desde\nextremo inferior',
    Texto3: 'Corte 2\nmedido desde\ncorte 1'
  };



  async function dibujarBloquePaso1(doc, x, y, w, h, valores) {
    const url = window.IMG_BASE + 'CortePerfilBis03.png';
    let img = await cargarImagen(url);
    if (!img) {
      dibujarPlaceholder(doc, x, y, w, h, 'CortePerfilBis03.png no disponible');
      return;
    }
    img = await recortarMargenes(img);   // elimina aire blanco del PNG

    const ratio = img.w / img.h;
    let ih = h, iw = h * ratio;            // priorizar alto (imagen vertical)
    if (iw > w) { iw = w; ih = w / ratio; }
    const ix = x + (w - iw) / 2;
    const iy = y + (h - ih) / 2;
    doc.addImage(img.dataUrl, 'PNG', ix, iy, iw, ih);

    // Mapa de colores por nombre
    const COLOR = { azul: COLOR_AZUL, rojo: [200,0,0], texto: COLOR_TEXTO };

    // Combinar valores numéricos + textos fijos
    const items = {
      Corte1: valores.Corte1,
      Corte2: valores.Corte2,
      Texto1: TEXTOS_PASO1.Texto1,
      Texto2: TEXTOS_PASO1.Texto2,
      Texto3: TEXTOS_PASO1.Texto3
    };

    Object.entries(PASO1_POS).forEach(([id, p]) => {
      const val = items[id];
      if (val === undefined || val === null || val === '') return;
      const cx = ix + (parseFloat(p.left) / 100) * iw;
      const cy = iy + (parseFloat(p.top)  / 100) * ih;
      setText(doc, COLOR[p.color] || COLOR_TEXTO);
      doc.setFont('helvetica', p.bold ? 'bold' : 'normal');
      doc.setFontSize(p.size);
      // Soporta saltos manuales con \n y wrap automático por ancho
      const txt = String(val);
      const lineas = txt.includes('\n')
        ? txt.split('\n')
        : (txt.length > 30 ? doc.splitTextToSize(txt, iw * 0.9) : [txt]);
      // Dibujar línea a línea (jsPDF ignora 'align' con arrays multilínea)
      const alturaLinea = p.size * 0.4;     // mm, aprox 0.4·tamaño en pt
      const align = p.align || 'center';
      lineas.forEach((linea, i) => {
        doc.text(linea, cx, cy + i * alturaLinea, { align });
      });
    });
  }

  // Recuadro placeholder con texto centrado
  function dibujarPlaceholder(doc, x, y, w, h, texto) {
    setDraw(doc, COLOR_LINEA);
    doc.setLineWidth(0.2);
    doc.setLineDashPattern([1, 1], 0);
    doc.rect(x, y, w, h);
    doc.setLineDashPattern([], 0);
    setText(doc, COLOR_LABEL);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(texto, x + w/2, y + h/2, { align: 'center' });
  }

  // ── ENTRADA PRINCIPAL ──────────────────────────────────────────
  async function generar(config) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      window.aviso ? window.aviso('jsPDF no está cargado.')
                   : alert('jsPDF no está cargado.');
      return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

    const fecha = new Date().toLocaleDateString('es-ES');

    await dibujarPagina1(doc, config);

    // Pies (TODO: cuando haya más páginas, recorrer todas)
    const total = doc.internal.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      dibujarPie(doc, i, total, fecha);
    }

    // Vista previa en nueva pestaña
    const blob = doc.output('blob');
    const url  = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }

  // ── Exponer ────────────────────────────────────────────────────
  window.SalidaPDFRasomuro = { generar };

})();
