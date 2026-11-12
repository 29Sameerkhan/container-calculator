// Downloads the plan on screen (summary, floor plan, pallet table) as an A4 PDF.
// The element is captured as an image and split across as many pages as needed.
// Libraries are loaded on demand so they stay out of the page bundle.

const PAGE_MARGIN_MM = 8;
const CAPTURE_SCALE = 2;
const QR_SIZE_MM = 26;
const FOOTER_GAP_MM = 4;

export function planPdfFilename(id: number | null, customerName: string): string {
  const customer = customerName.trim().replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '');
  return ['SLEKA-plan', id ? `#${id}` : null, customer || null].filter(Boolean).join('-') + '.pdf';
}

// The plan's public read-only page, on whichever site this is running from.
// Asks the server for the token, as a plan saved before tokens existed gets one now.
export async function planShareUrl(id: number): Promise<string> {
  const res = await fetch(`/api/calculations/${id}/share`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not get the share link');
  return `${window.location.origin}/plan/${data.shareToken}`;
}

// For the PDF footer: a failure here shouldn't stop the PDF, it just goes without the link
export async function planShareUrlForPdf(id: number): Promise<string | undefined> {
  try {
    return await planShareUrl(id);
  } catch (e) {
    console.error(e);
    return undefined;
  }
}

// shareUrl adds a link and QR code at the bottom of the last page
export async function exportPlanPdf(element: HTMLElement, filename: string, shareUrl?: string): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);

  const width = Math.max(element.scrollWidth, ...Array.from(element.querySelectorAll<HTMLElement>('.overflow-x-auto')).map(el => el.scrollWidth));
  // Parts a page break shouldn't cut through, in canvas pixels from the top
  let keepTogether: { top: number; bottom: number }[] = [];
  const canvas = await html2canvas(element, {
    scale: CAPTURE_SCALE,
    backgroundColor: '#ffffff',
    windowWidth: width + 48,
    onclone: (_doc, clone) => {
      // Scrolling panels (the floor plan, wide tables) are captured in full
      clone.style.width = `${width}px`;
      clone.querySelectorAll<HTMLElement>('.overflow-x-auto').forEach(el => { el.style.overflow = 'visible'; });
      clone.querySelectorAll<HTMLElement>('[data-pdf-hide]').forEach(el => { el.style.display = 'none'; });
      // PDF-only parts (company header, product entries) are hidden on screen
      clone.querySelectorAll<HTMLElement>('[data-pdf-only]').forEach(el => { el.style.display = 'block'; });
      // Shortened cells (product codes, customers) print in full, wrapped;
      // html2canvas also draws clipped text shifted down
      clone.querySelectorAll<HTMLElement>('.truncate').forEach(el => {
        el.style.overflow = 'visible';
        el.style.whiteSpace = 'normal';
        el.style.textOverflow = 'clip';
        el.style.wordBreak = 'break-all';
      });
      // Measured last, once the changes above have settled the layout
      const origin = clone.getBoundingClientRect().top;
      keepTogether = Array.from(clone.querySelectorAll<HTMLElement>('[data-pdf-keep]')).map(el => {
        const rect = el.getBoundingClientRect();
        return { top: (rect.top - origin) * CAPTURE_SCALE, bottom: (rect.bottom - origin) * CAPTURE_SCALE };
      });
    },
  });

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth() - PAGE_MARGIN_MM * 2;
  const pageH = pdf.internal.pageSize.getHeight() - PAGE_MARGIN_MM * 2;
  // Canvas pixels that fit on one page at full page width
  const pxPerPage = Math.floor(canvas.width * (pageH / pageW));

  let lastSliceMm = 0;
  for (let top = 0, page = 0, sliceH = 0; top < canvas.height; top += sliceH, page++) {
    const end = Math.min(top + pxPerPage, canvas.height);
    // A part the page would cut starts the next page instead (if it isn't at the top of this one)
    const cut = keepTogether.find(k => k.top > top && k.top < end && k.bottom > end);
    sliceH = Math.round((cut ? cut.top : end) - top);
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = sliceH;
    slice.getContext('2d')!.drawImage(canvas, 0, top, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
    if (page > 0) pdf.addPage();
    lastSliceMm = (sliceH * pageW) / canvas.width;
    pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', PAGE_MARGIN_MM, PAGE_MARGIN_MM, pageW, lastSliceMm);
  }

  if (shareUrl) {
    const { toDataURL } = await import('qrcode');
    const qr = await toDataURL(shareUrl, { margin: 1, width: 300 });
    // Bottom of the last page, on a new page if the plan leaves no room
    if (lastSliceMm + FOOTER_GAP_MM + QR_SIZE_MM > pageH) pdf.addPage();
    const y = PAGE_MARGIN_MM + pageH - QR_SIZE_MM;
    const textX = PAGE_MARGIN_MM + QR_SIZE_MM + 5;
    pdf.addImage(qr, 'PNG', PAGE_MARGIN_MM, y, QR_SIZE_MM, QR_SIZE_MM);
    pdf.setFontSize(11);
    pdf.setTextColor('#374151');
    pdf.text('View this plan in 3D:', textX, y + 10);
    pdf.setFontSize(10);
    pdf.setTextColor('#1d4ed8');
    pdf.textWithLink(shareUrl, textX, y + 16, { url: shareUrl });
  }

  pdf.save(filename);
}
