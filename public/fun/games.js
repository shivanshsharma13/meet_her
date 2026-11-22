import * as decks from './decks.js';

// Tiny DOM builder: h('button', { class: 'btn', onclick }, 'Text'). Strings are always text, never HTML.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else el[key] = value;
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

function pickIndex(deck, used) {
  if (used.size >= deck.length) used.clear();
  let i;
  do i = Math.floor(Math.random() * deck.length);
  while (used.has(i));
  used.add(i);
  return i;
}

const normalize = (s) => s.toLowerCase().replace(/[^a-z]/g, '');

// The panel re-renders whenever the other person does something, so keep what's being
// typed (and the keyboard focus) across renders.
const draft = { text: '', focused: false };

function textInput(placeholder, onSubmit) {
  const input = h('input', { placeholder, maxLength: 120, value: draft.text });
  input.addEventListener('input', () => (draft.text = input.value));
  input.addEventListener('focus', () => (draft.focused = true));
  input.addEventListener('blur', () => (draft.focused = false));
  if (draft.focused) queueMicrotask(() => input.focus());
  const submit = () => {
    const text = input.value.trim();
    if (!text) return;
    draft.text = '';
    onSubmit(text);
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  return h('div', { class: 'input-row' }, input, h('button', { class: 'btn primary small', onclick: submit }, 'Send'));
}

// Turn-based games. Every action goes through act(), which applies it on this device and
// sends it to the other one, so both screens always show the same thing.
// ctx: { sendPeer, me(), partner(), toast, floatEmojis, setDrawing(on), draw, room }
export function createGames(ctx) {
  const used = { truths: new Set(), dares: new Set(), wyr: new Set(), quiz: new Set(), pic: new Set() };
  let game = null; // { name, body, s: state }

  const me = () => ctx.me();
  const partner = () => ctx.partner();
  const nameOf = (uid) => (uid === me().uid ? me().name : partner().name);
  const youOr = (uid) => (uid === me().uid ? 'You' : partner().name);

  function act(msg) {
    const full = { type: 'game', game: game.name, ...msg };
    apply(full);
    ctx.sendPeer(full);
  }

  function apply(m) {
    if (!game || m.game !== game.name) return;
    if (m.action === 'round' || m.action === 'next') draft.text = '';
    games[m.game].apply(m, game.s);
    render();
  }

  function render() {
    if (game) game.body.replaceChildren(...[games[game.name].render(game.s)].flat().filter(Boolean));
  }

  const games = {
    tod: {
      start() {},
      apply(m, s) {
        s.card = m;
      },
      render(s) {
        const draw = (kind) => act({
          action: 'card',
          kind,
          by: me().uid,
          index: pickIndex(kind === 'truth' ? decks.truths : decks.dares, used[kind === 'truth' ? 'truths' : 'dares']),
        });
        const card = s.card && h('div', { class: 'game-card' },
          h('div', { class: 'game-label' }, `${youOr(s.card.by)} picked ${s.card.kind === 'truth' ? '🤫 Truth' : '🔥 Dare'}`),
          h('div', { class: 'game-text' }, (s.card.kind === 'truth' ? decks.truths : decks.dares)[s.card.index]));
        return [
          card || h('p', { class: 'game-hint' }, 'Take turns picking a card for yourself 👇'),
          h('div', { class: 'row' },
            h('button', { class: 'btn soft', onclick: () => draw('truth') }, '🤫 Truth'),
            h('button', { class: 'btn primary', onclick: () => draw('dare') }, '🔥 Dare')),
        ];
      },
    },

    wyr: {
      start() {
        act({ action: 'next', index: pickIndex(decks.wouldYouRather, used.wyr) });
      },
      apply(m, s) {
        if (m.action === 'next') {
          s.index = m.index;
          s.picks = {};
        } else if (m.action === 'pick') {
          s.picks[m.uid] = m.choice;
          const values = Object.values(s.picks);
          if (values.length === 2 && values[0] === values[1]) ctx.floatEmojis('💞', 12);
        }
      },
      render(s) {
        if (s.index == null) return h('p', { class: 'game-hint' }, 'Shuffling…');
        const options = decks.wouldYouRather[s.index];
        const mine = s.picks[me().uid];
        const theirs = s.picks[partner().uid];
        const both = mine != null && theirs != null;
        return [
          h('div', { class: 'game-label' }, 'Would you rather…'),
          h('div', { class: 'choices' }, options.map((text, i) => h('button', {
            class: `choice${mine === i ? ' picked' : ''}`,
            disabled: mine != null,
            onclick: () => act({ action: 'pick', uid: me().uid, choice: i }),
          }, text, both && h('small', {}, [mine === i && 'You', theirs === i && partner().name].filter(Boolean).join(' & '))))),
          both
            ? h('p', { class: 'game-result' }, mine === theirs ? 'Same answer! 💞' : 'Opposites attract 😄')
            : mine != null && h('p', { class: 'game-hint' }, `Waiting for ${partner().name}…`),
          both && h('button', { class: 'btn primary', onclick: () => games.wyr.start() }, 'Next question'),
        ];
      },
    },

    quiz: {
      open(s) {
        s.scores = {};
        s.unsub = ctx.room.watchQuizScores((scores) => {
          s.scores = scores;
          render();
        });
      },
      start(target = partner().uid) {
        act({ action: 'round', index: pickIndex(decks.quiz, used.quiz), target });
      },
      apply(m, s) {
        if (m.action === 'round') Object.assign(s, { index: m.index, target: m.target, answers: {}, judged: null });
        else if (m.action === 'answer') s.answers[m.uid] = m.text;
        else if (m.action === 'judge') {
          s.judged = m.correct ? 'yes' : 'no';
          if (m.correct) ctx.floatEmojis('🎉', 14);
        }
      },
      render(s) {
        const score = h('div', { class: 'game-score' },
          `${me().name} ${s.scores[me().uid] || 0} · ${partner().name} ${s.scores[partner().uid] || 0}`);
        if (s.index == null) return [score, h('p', { class: 'game-hint' }, 'Shuffling…')];

        const iAmTarget = s.target === me().uid;
        const guesser = iAmTarget ? partner().uid : me().uid;
        const question = decks.quiz[s.index].replace(/\{name\}'s/g, iAmTarget ? 'your' : `${nameOf(s.target)}'s`)
          .replace(/\{name\}/g, iAmTarget ? 'you' : nameOf(s.target));
        const myAnswer = s.answers[me().uid];
        const theirAnswer = s.answers[partner().uid];
        const parts = [
          score,
          h('div', { class: 'game-label' }, iAmTarget ? 'Answer honestly about yourself' : `Guess what ${partner().name} will say`),
          h('div', { class: 'game-text' }, question),
        ];

        if (myAnswer == null) {
          parts.push(textInput(iAmTarget ? 'Your answer' : 'Your guess', (text) => act({ action: 'answer', uid: me().uid, text })));
        } else if (theirAnswer == null) {
          parts.push(h('p', { class: 'game-hint' }, `Waiting for ${partner().name}…`));
        } else {
          parts.push(h('div', { class: 'reveal' },
            h('div', {}, h('b', {}, `${nameOf(s.target)} said: `), s.answers[s.target]),
            h('div', {}, h('b', {}, `${nameOf(guesser)} guessed: `), s.answers[guesser])));
          if (!s.judged) {
            parts.push(iAmTarget
              ? h('div', { class: 'row' },
                h('button', { class: 'btn soft', onclick: () => act({ action: 'judge', correct: false }) }, '✗ Not quite'),
                h('button', {
                  class: 'btn primary',
                  onclick: () => {
                    ctx.room.addQuizPoint(guesser);
                    act({ action: 'judge', correct: true });
                  },
                }, '✓ Got it'))
              : h('p', { class: 'game-hint' }, `${partner().name} is deciding if you got it…`));
          } else {
            parts.push(
              h('p', { class: 'game-result' }, s.judged === 'yes' ? `+1 for ${youOr(guesser)} 🎉` : 'Not this time 😄'),
              h('button', { class: 'btn primary', onclick: () => games.quiz.start(guesser) }, 'Next question'),
            );
          }
        }
        return parts;
      },
      close(s) {
        s.unsub?.();
      },
    },

    pic: {
      start(drawer = me().uid) {
        act({ action: 'round', index: pickIndex(decks.pictionaryWords, used.pic), drawer });
      },
      apply(m, s) {
        if (m.action === 'round') {
          clearInterval(s.timer);
          Object.assign(s, { index: m.index, drawer: m.drawer, guesses: [], solved: null, timeUp: false, left: 90 });
          ctx.draw.clearLocal();
          ctx.setDrawing(m.drawer === me().uid);
          s.timer = setInterval(() => {
            s.left -= 1;
            if (s.left > 0) {
              if (s.timerEl) s.timerEl.textContent = `⏱ ${s.left}s`; // just the clock, so typing isn't interrupted
              return;
            }
            clearInterval(s.timer);
            s.timeUp = true;
            ctx.setDrawing(false);
            render();
          }, 1000);
        } else if (m.action === 'guess') {
          s.guesses.push(m);
        } else if (m.action === 'solved') {
          s.guesses.push(m);
          s.solved = m.uid;
          clearInterval(s.timer);
          ctx.setDrawing(false);
          ctx.floatEmojis('🎉', 16);
        }
      },
      render(s) {
        if (s.index == null) return h('p', { class: 'game-hint' }, 'Picking a word…');
        const word = decks.pictionaryWords[s.index];
        const iDraw = s.drawer === me().uid;
        const over = s.solved || s.timeUp;
        s.timerEl = h('div', { class: 'game-score' }, over ? 'Round over' : `⏱ ${s.left}s`);
        const parts = [s.timerEl];

        if (s.solved) parts.push(h('p', { class: 'game-result' }, `🎉 ${youOr(s.solved)} got it: ${word}`));
        else if (s.timeUp) parts.push(h('p', { class: 'game-result' }, `⏰ Time's up! It was "${word}"`));
        else if (iDraw) parts.push(h('div', { class: 'game-label' }, 'Draw this on the screen:'), h('div', { class: 'game-text' }, word));
        else {
          parts.push(
            h('div', { class: 'game-label' }, `Guess what ${partner().name} is drawing!`),
            textInput('Your guess', (text) => {
              const correct = normalize(text) === normalize(word);
              act({ action: correct ? 'solved' : 'guess', uid: me().uid, text });
            }),
          );
        }
        if (s.guesses.length && !s.solved) {
          parts.push(h('div', { class: 'guesses' }, s.guesses.slice(-4).map((g) => h('span', {}, g.text))));
        }
        if (over) {
          const nextDrawer = iDraw ? partner().uid : me().uid;
          parts.push(h('button', { class: 'btn primary', onclick: () => games.pic.start(nextDrawer) },
            `Next round (${youOr(nextDrawer) === 'You' ? 'you draw' : `${partner().name} draws`})`));
        }
        return parts;
      },
      close(s) {
        clearInterval(s.timer);
        ctx.setDrawing(false);
        ctx.draw.clearLocal();
      },
    },
  };

  return {
    has: (name) => name in games,
    open(name, body, initiator) {
      game = { name, body, s: {} };
      games[name].open?.(game.s);
      render();
      if (initiator) games[name].start();
    },
    close() {
      if (!game) return;
      games[game.name].close?.(game.s);
      game = null;
    },
    onMessage: apply,
  };
}
