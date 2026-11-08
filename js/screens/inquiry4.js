// 탐구 4 — 특이한 변화 (부산 관측 조위: 기간 A·B)
// 공개 전: 두 기간의 관측 조위만(실제 날짜 표시, 같은 눈금 크기). 기상·태풍 관련 표시 없음.
// [추가 자료 확인] 후: 두 기간의 ASOS 해면기압·풍속·풍향(같은 시간 축), 시각 연결, 태풍 경로 지도.
// 시각 연결(조위·기압·바람·태풍 시각을 함께 보기)은 자료의 시간대가 확인된 경우에만 켠다.
import { h } from '../util/dom.js';
import { fmtNum, escapeHtml } from '../util/format.js';
import { fmtDateTime } from '../util/time.js';
import { INQUIRIES, OBSERVED_TEXT, CIRCLED } from '../content/questions.js';
import { createPanel, SharedCursor, tipRow, staticLayoutHTML } from '../chart/panel.js';
import { inq4TideSpecs, weatherSpec, periodTitle, periodCd, typhoonMapLayout, closestTyphoonPoint, fmtWx, valueAt, PERIOD_NAMES } from '../chart/assess.js';
import { screenMeasure } from '../chart/svg.js';
import { loadKoreaMap } from '../chart/map.js';
import { nearestValid, pointAt } from '../analysis/series.js';
import { inquiryHeader, questionShell, simpleTextQuestion, revealCard, textAnswer, answerOf } from './common.js';

const WX = ['pressureSea', 'windSpeed', 'windDir'];

export function render(app, container) {
  const { ad, store } = app;
  const def = INQUIRIES[3];
  const tz = ad.tz;
  const S = () => store.state;
  const [Q9, Q10, Q11] = def.questions;
  const revealed = !!S().reveals.weather;
  const timeOk = !!ad.timeBasis?.confirmed;
  const panels = [];
  const fixed = { a: null, b: null };

  container.append(inquiryHeader(def));
  const ws = h('div', { class: 'workspace' });
  const left = h('section', { class: 'analysis', 'aria-label': '그래프' });
  const right = h('aside', { class: 'qpanel', 'aria-label': '문항과 답' });
  ws.append(left, right);
  container.append(ws);

  const tideTip = (k) => (tg) => `<div class="tip-title">${escapeHtml(PERIOD_NAMES[k])} · ${escapeHtml(fmtDateTime(tg.t, tz))}</div>${tipRow('관측 조위', tg.v != null ? `${fmtNum(tg.v, 1)} cm` : '자료 없음')}`;
  const tidePick = (k) => (t) => { const cd = periodCd(ad, k); const p = nearestValid(cd.observed.points, t, { t0: ad.win[k][0], t1: ad.win[k][1] }); return p ? { t: p.t, v: p.v } : null; };

  if (!revealed) {
    const card = h('div', { class: 'card chart-card', id: 'inq4-tide' });
    card.append(h('div', { class: 'card-head' }, h('h2', {}, '부산 관측 조위 — 두 기간'), h('p', { class: 'data-line' }, `관측 조위: ${OBSERVED_TEXT} 두 그래프의 세로 눈금 간격(cm)은 같고, 각자 가운데에 맞췄습니다.`)));
    left.append(card);
    ['a', 'b'].forEach((k, i) => {
      const host = h('div', { class: 'chart-host', id: `inq4-tide-${k}` });
      card.append(host);
      panels.push(createPanel({ host, height: 240, ariaLabel: `부산 관측 조위 ${periodTitle(ad, k, false)}`, build: (ctx) => inq4TideSpecs(ctx, ad, { revealed: false })[i], pick: tidePick(k), describe: tideTip(k) }));
    });
  } else {
    if (!timeOk) left.append(h('p', { class: 'notice notice-warn', id: 'time-gate' }, '자료의 시간대가 확인되지 않아 시각 연결(같은 시각의 조위·기압·바람 함께 보기)을 켜지 않았습니다.'));
    for (const k of ['a', 'b']) {
      const cd = periodCd(ad, k);
      const cursor = timeOk ? new SharedCursor() : null;
      const block = h('div', { class: 'card chart-card period-block', id: `inq4-block-${k}` });
      block.append(h('div', { class: 'card-head' }, h('h2', {}, periodTitle(ad, k, true)),
        h('p', { class: 'data-line' }, `기상: ${cd.weather?.station?.name || '기상 관측 지점'}${cd.weather?.station?.note ? ` — ${cd.weather.station.note}` : ''} · 1시간 간격 · 시각 ${tz.label}`),
        timeOk ? h('p', { class: 'small muted' }, '그래프를 누르면 그 시각의 값이 아래 표에 나타나고, 같은 시각에 세로선이 그어집니다.') : null));
      left.append(block);
      const valBox = h('div', { class: 'time-values', id: `inq4-values-${k}`, 'aria-live': 'polite' });
      const onClick = timeOk ? (tg) => { fixed[k] = tg.t; cursor.set(tg.t); renderValues(k, valBox); } : null;
      const hostT = h('div', { class: 'chart-host', id: `inq4-tide-${k}` });
      block.append(hostT);
      const i = k === 'a' ? 0 : 1;
      panels.push(createPanel({ host: hostT, height: 230, ariaLabel: `부산 관측 조위 ${PERIOD_NAMES[k]}`, cursor, build: (ctx) => inq4TideSpecs(ctx, ad, { revealed: true })[i], pick: tidePick(k), describe: tideTip(k), onClick }));
      for (const kind of WX) {
        const host = h('div', { class: 'chart-host', id: `inq4-${kind}-${k}` });
        block.append(host);
        panels.push(createPanel({
          host, height: kind === 'pressureSea' ? 180 : 165, ariaLabel: `${kind} ${PERIOD_NAMES[k]}`, cursor,
          build: (ctx) => weatherSpec(ctx, ad, k, kind),
          pick: (t) => { const p = cd.weather ? nearestValid(cd.weather.points, t, { key: kind, t0: ad.win[k][0], t1: ad.win[k][1] }) : null; return p ? { t: p.t, v: p[kind] } : null; },
          describe: (tg) => `<div class="tip-title">${escapeHtml(fmtDateTime(tg.t, tz))}</div>${tipRow(kind === 'pressureSea' ? '해면기압' : kind === 'windSpeed' ? '풍속' : '풍향', fmtWx(kind, tg.v))}`,
          onClick,
        }));
      }
      if (timeOk) { block.append(valBox); renderValues(k, valBox); }
    }
    // 태풍
    const tyCard = h('div', { class: 'card map-card', id: 'inq4-typhoon' });
    const closest = closestTyphoonPoint(ad);
    tyCard.append(h('h2', { class: 'h-sm' }, `태풍 정보 — ${PERIOD_NAMES.a}`));
    if (ad.past?.typhoon) {
      tyCard.append(h('p', { class: 'small' }, `${ad.past.typhoon.meta?.title || ad.past.typhoon.name}. 지도의 점은 기상청이 분석한 태풍 중심 위치이고, 옆 숫자는 그 시각(${tz.label})입니다.`));
      if (closest && timeOk) tyCard.append(h('p', { class: 'small', id: 'ty-closest' }, `부산 조위관측소에 가장 가까운 분석 위치: ${fmtDateTime(closest.t, tz)} · 약 ${Math.round(closest.km)} km${closest.pressure != null ? ` · 태풍 중심기압 ${closest.pressure} hPa` : ''} (분석 간격 사이에 실제 최근접 시각이 있을 수 있음)`));
      const mapHost = h('div', { class: 'track-map' });
      tyCard.append(mapHost);
      const drawMap = () => { const w = Math.min(560, Math.max(280, mapHost.clientWidth || 420)); const L = typhoonMapLayout(ad, { width: w, measure: screenMeasure, fontSize: 11 }); if (L) mapHost.innerHTML = staticLayoutHTML(L, '태풍 경로 지도'); };
      requestAnimationFrame(drawMap);
      loadKoreaMap().then(drawMap);
    } else tyCard.append(h('p', { class: 'muted' }, '태풍 정보: 자료 미제공'));
    tyCard.append(h('h2', { class: 'h-sm' }, `태풍 정보 — ${PERIOD_NAMES.b}`), h('p', { class: 'small', id: 'ty-recent' }, ad.recentTyphoonCheck?.text || '자료 미제공'));
    tyCard.append(h('ul', { class: 'small caution-list' },
      h('li', {}, '태풍 중심기압은 태풍 한가운데의 기압입니다. 부산에서 잰 기압(해면기압 그래프)과 같은 값이 아닙니다.'),
      h('li', {}, '시각이 가깝다는 것만으로 원인이라고 확정할 수 없습니다. 조위·기압·바람·태풍 위치를 함께 근거로 드세요.'),
      h('li', {}, '해면기압은 관측소 높이의 기압을 해수면 높이로 환산한 값으로, 현지기압과 섞어 비교하지 않습니다.')));
    left.append(tyCard);
  }

  function renderValues(k, box) {
    box.innerHTML = '';
    const t = fixed[k];
    if (t == null) { box.append(h('p', { class: 'muted small' }, '그래프를 누르면 그 시각의 값이 여기에 나타납니다.')); return; }
    const cd = periodCd(ad, k);
    const w = cd.weather ? pointAt(cd.weather.points, t) : null;
    box.append(h('table', { class: 'data-table compact' },
      h('caption', {}, `${PERIOD_NAMES[k]} · ${fmtDateTime(t, tz)} 의 값`),
      h('tbody', {},
        h('tr', {}, h('th', {}, '관측 조위'), h('td', {}, valueAt(cd.observed, t) != null ? `${fmtNum(valueAt(cd.observed, t), 1)} cm` : '자료 없음')),
        h('tr', {}, h('th', {}, '해면기압'), h('td', {}, fmtWx('pressureSea', w?.pressureSea))),
        h('tr', {}, h('th', {}, '풍속'), h('td', {}, fmtWx('windSpeed', w?.windSpeed))),
        h('tr', {}, h('th', {}, '풍향'), h('td', {}, fmtWx('windDir', w?.windDir))))));
  }

  // ── 문항 ──
  const list = h('ol', { class: 'questions' });
  right.append(list);
  for (const q of [Q9, Q10]) { const li = simpleTextQuestion(app, q); if (li) list.append(li); }
  right.append(revealCard(app, 'weather', {
    title: '추가 자료 확인',
    text: `${CIRCLED[9]}·${CIRCLED[10]}의 답은 이 버튼을 누르는 순간 그대로 보관되고, 그 뒤에는 고칠 수 없습니다. 누르면 원인을 확인할 수 있는 추가 자료가 나타납니다.`,
    doneText: `${CIRCLED[9]}·${CIRCLED[10]}은 확인 전 답으로 고정되었습니다.`,
  }));
  const list2 = h('ol', { class: 'questions' });
  right.append(list2);
  const sh11 = questionShell(app, Q11);
  if (sh11) {
    if (!sh11.waiting) {
      const prev = answerOf(S(), Q10) || '';
      sh11.body.append(h('div', { class: 'compare-prev', id: 'q11-prev' },
        h('p', { class: 'compare-prev-title' }, `내가 ${CIRCLED[10]}에 쓴 추측(추가 자료 확인 전)`),
        prev.trim() ? h('p', { class: 'compare-prev-text' }, prev) : h('p', { class: 'muted small' }, '(작성하지 않음)')),
      textAnswer(app, Q11, { value: S().answers.q11, rows: 3, max: 800, placeholder: '기상·태풍 자료에서 근거를 하나 이상 들어 1~2문장으로 쓰세요.', onInput: (v) => store.update((s) => { s.answers.q11 = v; }, { topic: 'answer' }) }));
    }
    list2.append(sh11.li);
  }
  return { destroy() { panels.forEach((p) => p.destroy()); } };
}

