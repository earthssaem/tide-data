// 관측소 선택: 선생님이 평가에 쓰도록 켠 관측소만 보여 준다(지도 + 해역별 목록).
// 관측소 소개에 학생이 발견해야 할 결과(조차가 큰 곳, 태풍 영향 등)는 쓰지 않는다.
// 미리 수집해 둔 파일만 읽는다(외부 API 호출 없음).
import { h } from '../util/dom.js';
import { escapeHtml } from '../util/format.js';
import { fmtRange } from '../util/time.js';
import { fmtLatLon } from '../analysis/geo.js';
import { stationMapSvg } from './station-picker.js';
import { loadKoreaMap } from '../chart/map.js';
import { enabledStations } from '../setup/setup.js';

const SEAS = ['서해', '남해', '동해'];

export function render(app, container) {
  const { cd, store } = app;
  const list = enabledStations(cd);
  const curId = store.state.stationId;
  let pending = list.find((s) => s.id === curId)?.id || null;

  container.append(h('div', { class: 'inq-head' },
    h('h1', {}, '관측소 선택'),
    h('p', { class: 'inq-intro' }, '선생님이 평가에 사용하도록 준비한 관측소입니다. 지도나 목록에서 탐구할 지역을 고른 뒤 [이 지역 탐구하기]를 누르세요.')));
  if (curId && !list.some((s) => s.id === curId)) {
    container.append(h('p', { class: 'notice notice-warn' }, `이전에 고른 관측소(${curId})는 지금 평가에 사용하지 않도록 설정되어 있습니다. 그 관측소에서 쓴 내용은 지우지 않고 보관합니다.`));
  }
  if (!list.length) {
    container.append(h('section', { class: 'card' }, h('p', { class: 'notice notice-warn' }, '선생님이 아직 평가에 사용할 관측소를 설정하지 않았습니다. 선생님께 알려 주세요.')));
    return null;
  }

  const lay = h('div', { class: 'station-layout' });
  const mapBox = h('div', { class: 'card station-map-card' });
  const mapHost = h('div', { class: 'sp-map', id: 'station-map' });
  mapBox.append(h('h2', { class: 'h-sm' }, '지도에서 고르기'), mapHost,
    h('p', { class: 'small muted sp-legend' }, '● 서해 · ■ 남해 · ▲ 동해'));
  const listBox = h('div', { class: 'card station-list-card' });
  listBox.append(h('h2', { class: 'h-sm' }, '목록에서 고르기'));
  const listHost = h('div', { class: 'sp-list', id: 'station-list' });
  listBox.append(listHost);
  const detail = h('section', { class: 'card station-detail', id: 'station-detail', 'aria-live': 'polite' });
  lay.append(mapBox, listBox, detail);
  container.append(lay);
  container.append(h('p', { class: 'notice notice-warn small' }, '관측소마다 조위(높이)를 재는 기준면이 다를 수 있고 아직 확인되지 않았습니다. 다른 관측소와 비교할 때 조위 숫자만 보고 어느 지역의 해수면이 더 높다고 말할 수 없습니다.'));

  let map = null;
  const drawMap = () => {
    mapHost.innerHTML = stationMapSvg(map, list, pending, { width: 420 });
  };
  mapHost.addEventListener('click', (e) => { const g = e.target.closest('.map-st'); if (g) choose(g.dataset.id); });
  loadKoreaMap().then((m) => { map = m; drawMap(); });

  function renderList() {
    const others = list.filter((s) => !SEAS.includes(s.sea));
    const group = (title, arr) => (arr.length ? `<section class="sp-group"><h3>${escapeHtml(title)}</h3><ul>${arr.map((s) => `
      <li class="sp-item${s.id === pending ? ' cur' : ''}"><button type="button" class="sp-pick" data-id="${escapeHtml(s.id)}" aria-pressed="${s.id === pending}">
        <span class="sp-name">${escapeHtml(s.name)} <span class="muted small">${escapeHtml(s.id)}</span>${s.id === curId ? ' <span class="badge badge-ok">탐구 중</span>' : ''}</span>
        <span class="small muted">${escapeHtml(s.sea || '')}</span></button></li>`).join('')}</ul></section>` : '');
    listHost.innerHTML = SEAS.map((sea) => group(sea, list.filter((s) => s.sea === sea))).join('') + group(others.length && !SEAS.some((x) => list.some((s) => s.sea === x)) ? '관측소' : '기타', others);
  }
  listHost.addEventListener('click', (e) => { const b = e.target.closest('.sp-pick'); if (b) choose(b.dataset.id); });

  function renderDetail() {
    detail.innerHTML = '';
    const s = list.find((x) => x.id === pending);
    if (!s) { detail.append(h('p', { class: 'muted' }, '지도나 목록에서 관측소를 고르면 위치와 분석 기간이 여기에 나타납니다.')); return; }
    const c = s.cd;
    detail.append(...[
      h('h2', {}, `${s.name} 조위관측소`),
      h('dl', { class: 'case-dl' },
        h('div', {}, h('dt', {}, '관측소 코드'), h('dd', {}, s.id)),
        h('div', {}, h('dt', {}, '해역'), h('dd', {}, s.sea || '—')),
        h('div', {}, h('dt', {}, '위치'), h('dd', {}, fmtLatLon(s.lat, s.lon))),
        h('div', {}, h('dt', {}, '분석 기간'), h('dd', { id: 'station-period' }, fmtRange(c.ranges.inq2[0], c.ranges.inq2[1], c.tz))),
        h('div', {}, h('dt', {}, '자료'), h('dd', {}, `관측 조위 · 관측 간격 ${c.observed.intervalMs / 3600e3}시간`))),
      h('button', { type: 'button', class: 'btn btn-primary btn-lg', id: 'btn-explore', onclick: () => go(s.id) }, s.id === curId ? '이 지역 계속 탐구하기' : '이 지역 탐구하기'),
      curId && s.id !== curId ? h('p', { class: 'small muted' }, '관측소를 바꾸면 지금까지 쓴 답과 분석은 원래 관측소에 그대로 보관되고, 새 관측소는 따로 작성합니다. 이미 만든 근거는 만든 관측소의 자료로 남습니다.') : null,
    ].filter(Boolean));
  }

  function choose(id) {
    pending = id;
    drawMap();
    renderList();
    renderDetail();
  }
  function go(id) {
    if (id !== store.state.stationId) app.selectStation(id, { rerender: false });
    app.navigate('inq1');
  }

  renderList();
  renderDetail();
  return null;
}
