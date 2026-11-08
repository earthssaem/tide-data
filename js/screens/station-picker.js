// 관측소 선택(지도 + 목록) — 여러 관측소 사례에서만 사용
// 미리 수집해 둔 관측소 파일만 보여 준다(외부 API 호출 없음).

import { h } from '../util/dom.js';
import { escapeHtml } from '../util/format.js';

let mapCache = null;
async function loadMap() {
  if (mapCache) return mapCache;
  try {
    const res = await fetch('data/map/korea-land.json');
    mapCache = res.ok ? await res.json() : null;
  } catch { mapCache = null; }
  return mapCache;
}

const SEA_COLOR = { 서해: '#1f3a68', 남해: '#0f8b8d', 동해: '#8a4b00' };
const SEA_SHAPE = { 서해: 'circle', 남해: 'square', 동해: 'triangle' };

export function availabilityBadges(s) {
  const a = s.cd.availability;
  const w = s.weatherSource;
  const wx = !a.weather ? '기상 자료 없음' : w?.type === 'asos' ? `기상: ${w.station?.name || 'ASOS'}${w.distKm != null ? ` · ${w.distKm} km` : ''}` : '기상: 같은 조위관측소';
  return [
    { ok: true, text: '관측 조위' },
    { ok: a.predicted, text: a.predicted ? '예측 조위' : '예측 조위 없음' },
    { ok: a.weather, text: wx },
  ];
}

function shapeSvg(shape, x, y, r, fill, stroke = '#fff') {
  if (shape === 'square') return `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
  if (shape === 'triangle') return `<polygon points="${x},${y - r * 1.2} ${x + r * 1.1},${y + r * 0.8} ${x - r * 1.1},${y + r * 0.8}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
}

/** 지도 SVG(관측소 클릭 가능) */
export function stationMapSvg(map, stations, currentId, { width = 420 } = {}) {
  const box = map?.bbox || { minX: 123.6, maxX: 131.4, minY: 32.6, maxY: 38.9 };
  const kx = Math.cos((36 * Math.PI) / 180);
  const sc = width / ((box.maxX - box.minX) * kx);
  const height = Math.round((box.maxY - box.minY) * sc);
  const X = (lon) => ((lon - box.minX) * kx * sc).toFixed(1);
  const Y = (lat) => ((box.maxY - lat) * sc).toFixed(1);
  const land = (map?.rings || []).map((r) => `<path d="M${r.map(([lo, la]) => `${X(lo)},${Y(la)}`).join('L')}Z"/>`).join('');
  const dots = stations.map((s) => {
    const x = Number(X(s.lon)), y = Number(Y(s.lat));
    const cur = s.id === currentId;
    const fill = SEA_COLOR[s.sea] || '#45505e';
    const labelLeft = s.lon > 129.6;
    return `<g class="map-st${cur ? ' cur' : ''}" data-id="${escapeHtml(s.id)}" tabindex="-1">
      ${cur ? `<circle cx="${x}" cy="${y}" r="11" fill="none" stroke="#d9480f" stroke-width="2.5"/>` : ''}
      ${shapeSvg(SEA_SHAPE[s.sea] || 'circle', x, y, 6, fill)}
      <text x="${labelLeft ? x - 10 : x + 10}" y="${y + 4}" font-size="12" font-weight="700" text-anchor="${labelLeft ? 'end' : 'start'}" fill="#1d2733" stroke="#fff" stroke-width="3" paint-order="stroke">${escapeHtml(s.name)}</text>
    </g>`;
  }).join('');
  return `<svg class="station-map" viewBox="0 0 ${width} ${height}" role="img" aria-label="조위관측소 위치 지도">
    <rect width="${width}" height="${height}" fill="#eaf3f7"/>
    <g fill="#f6f4ee" stroke="#9aa5b1" stroke-width="0.8">${land}</g>
    ${dots}
    <text x="6" y="${height - 6}" font-size="9" fill="#5b6675">해안선: Natural Earth(단순화) · 위치 안내용</text>
  </svg>`;
}

export async function openStationPicker(app) {
  const cd = app.cd;
  if (!cd.multi) return;
  const map = await loadMap();
  const dlg = h('dialog', { class: 'dialog station-dialog', 'aria-labelledby': 'sp-title' });
  const seas = ['서해', '남해', '동해'];
  const others = cd.stations.filter((s) => !seas.includes(s.sea));
  const group = (title, list) => (list.length ? `<section class="sp-group"><h3>${escapeHtml(title)}</h3><ul>${list.map((s) => `
    <li class="sp-item${s.id === cd.station.id ? ' cur' : ''}">
      <button type="button" class="sp-pick" data-id="${escapeHtml(s.id)}" aria-pressed="${s.id === cd.station.id}">
        <span class="sp-name">${escapeHtml(s.name)} <span class="muted small">${escapeHtml(s.id)}</span>${s.id === cd.station.id ? ' <span class="badge badge-ok">선택됨</span>' : ''}</span>
        <span class="sp-badges">${availabilityBadges(s).map((b) => `<span class="sp-badge ${b.ok ? 'ok' : 'no'}">${b.ok ? '●' : '○'} ${escapeHtml(b.text)}</span>`).join('')}</span>
      </button></li>`).join('')}</ul></section>` : '');
  dlg.innerHTML = `<div class="dialog-form">
    <h2 id="sp-title" class="dialog-title">관측소 선택</h2>
    <p class="small muted">선생님이 미리 준비한 관측소입니다. 관측소를 바꾸면 그래프와 표가 그 관측소의 자료로 바뀝니다. 이미 추가한 근거는 만든 관측소의 자료로 그대로 남습니다.</p>
    <div class="sp-layout">
      <div class="sp-map">${stationMapSvg(map, cd.stations, cd.station.id)}
        <p class="small muted sp-legend"><span style="color:${SEA_COLOR.서해}">●</span> 서해 · <span style="color:${SEA_COLOR.남해}">■</span> 남해 · <span style="color:${SEA_COLOR.동해}">▲</span> 동해</p></div>
      <div class="sp-list">${seas.map((sea) => group(sea, cd.stations.filter((s) => s.sea === sea))).join('')}${group('기타', others)}</div>
    </div>
    <p class="notice notice-warn small">관측소마다 조위(높이)를 재는 기준면이 다를 수 있고 아직 확인되지 않았습니다. 두 관측소의 조위 숫자만 보고 어느 지역의 해수면이 더 높다고 말할 수 없습니다. 비교할 것은 각 관측소 안에서의 변동 폭, 주기, 만조·간조 시각입니다.</p>
    ${cd.failedStations?.length ? `<p class="small muted">불러오지 못한 관측소: ${cd.failedStations.map((f) => escapeHtml(f.name)).join(', ')}</p>` : ''}
    <div class="dialog-actions"><button type="button" class="btn btn-secondary" value="cancel">닫기</button></div>
  </div>`;
  const choose = (id) => { dlg.close(); if (id !== cd.station.id) app.selectStation(id); };
  dlg.addEventListener('click', (e) => {
    const b = e.target.closest('.sp-pick');
    if (b) { choose(b.dataset.id); return; }
    const g = e.target.closest('.map-st');
    if (g) { choose(g.dataset.id); return; }
    if (e.target.closest('[value=cancel]')) dlg.close();
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  dlg.querySelector('.sp-item.cur .sp-pick, .sp-pick')?.focus();
}
