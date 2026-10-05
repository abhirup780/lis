import JsBarcode from 'jsbarcode'
import { date, fullName } from './format'
import type { PatientBrief, SpecimenBrief } from './types'

function barcodeSvg(value: string): string {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  JsBarcode(svg, value, { format: 'CODE128', height: 34, width: 1.5, displayValue: false, margin: 0 })
  return svg.outerHTML
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Open a print window with one 2" x 1" barcode label per specimen. */
export function printLabels(
  specimens: (SpecimenBrief & { tests?: { code: string }[] })[],
  patient: PatientBrief,
  orderNumber: string,
  priority: string,
) {
  const labels = specimens
    .map(
      (s) => `
      <div class="label">
        <div class="row"><b>${escape(fullName(patient))}</b><span>${priority === 'stat' ? '<b class="stat">STAT</b>' : ''}</span></div>
        <div class="row small"><span>${escape(patient.mrn)}</span><span>DOB ${escape(date(patient.date_of_birth))} ${patient.sex}</span></div>
        <div class="bc">${barcodeSvg(s.accession)}</div>
        <div class="row small"><b class="acc">${s.accession}</b><span>${escape(s.specimen_type.code)} · ${escape(orderNumber)}</span></div>
        ${s.tests ? `<div class="small tests">${escape(s.tests.map((t) => t.code).join(' '))}</div>` : ''}
      </div>`,
    )
    .join('')
  const w = window.open('', '_blank', 'width=480,height=640')
  if (!w) return
  w.document.write(`<!doctype html><html><head><title>Labels ${orderNumber}</title><style>
    @page { size: 2in 1in; margin: 0; }
    body { margin: 0; font-family: Arial, sans-serif; }
    .label { width: 2in; height: 1in; box-sizing: border-box; padding: 0.05in 0.08in; page-break-after: always; overflow: hidden; }
    .row { display: flex; justify-content: space-between; font-size: 8pt; line-height: 1.15; }
    .small { font-size: 6.5pt; }
    .bc svg { width: 100%; height: 0.36in; }
    .acc { font-family: monospace; font-size: 8pt; letter-spacing: 0.5px; }
    .stat { color: white; background: black; padding: 0 3px; }
    .tests { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    @media screen { body { background: #e2e8f0; padding: 12px; } .label { background: white; margin-bottom: 8px; border-radius: 4px; } }
  </style></head><body>${labels}<script>window.onload = () => { window.print() }</script></body></html>`)
  w.document.close()
}
