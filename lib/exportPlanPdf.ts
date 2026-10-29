// Downloads the plan on screen (summary, floor plan, pallet table) as an A4 PDF.
// The element is captured as an image and split across as many pages as needed.
// Libraries are loaded on demand so they stay out of the page bundle.

const PAGE_MARGIN_MM = 8;

export function planPdfFilename(id: number | null, customerName: string): string {
  const customer = customerName.trim().replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '');
  return ['SLEKA-plan', id ? `#${id}` : null, customer || null].filter(Boolean).join('-') + '.pdf';
}

export async function exportPlanPdf(element: HTMLElement, filename: string): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);

  const width = Math.max(element.scrollWidth, ...Array.from(element.querySelectorAll<HTMLElement>('.overflow-x-auto')).map(el => el.scrollWidth));
  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: '#ffffff',
    windowWidth: width + 48,
    onclone: (_doc, clone) => {
      // Scrolling panels (the floor plan, wide tables) are captured in full
      clone.style.width = `${width}px`;
      clone.querySelectorAll<HTMLElement>('.overflow-x-auto').forEach(el => { el.style.overflow = 'visible'; });
      clone.querySelectorAll<HTMLElement>('[data-pdf-hide]').forEach(el => { el.style.display = 'none'; });
      // Shortened cells (product codes, customers) print in full, wrapped;
      // html2canvas also draws clipped text shifted down
      clone.querySelectorAll<HTMLElement>('.truncate').forEach(el => {
        el.style.overflow = 'visible';
        el.style.whiteSpace = 'normal';
        el.style.textOverflow = 'clip';
        el.style.wordBreak = 'break-all';
      });
    },
  });

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth() - PAGE_MARGIN_MM * 2;
  const pageH = pdf.internal.pageSize.getHeight() - PAGE_MARGIN_MM * 2;
  // Canvas pixels that fit on one page at full page width
  const pxPerPage = Math.floor(canvas.width * (pageH / pageW));

  for (let top = 0, page = 0; top < canvas.height; top += pxPerPage, page++) {
    const sliceH = Math.min(pxPerPage, canvas.height - top);
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = sliceH;
    slice.getContext('2d')!.drawImage(canvas, 0, top, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
    if (page > 0) pdf.addPage();
    pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', PAGE_MARGIN_MM, PAGE_MARGIN_MM, pageW, (sliceH * pageW) / canvas.width);
  }

  pdf.save(filename);
}
