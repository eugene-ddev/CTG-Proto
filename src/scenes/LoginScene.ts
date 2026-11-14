// Вход в игру: сохранённый игрок входит сам, новый вводит имя. Состояние приходит с сервера.
import { store, type Remote } from '../game/store';
import { NetError, SERVER_ADDRESS, net, type PlayerView } from '../net/client';
import { Button } from '../ui/Button';
import { Card } from '../ui/Panel';
import { TextField } from '../ui/TextField';
import { text } from '../ui/text';
import { COLOR, GAME_W } from '../ui/theme';
import { BaseScene } from './BaseScene';
import { SCENE } from './keys';

const NAME_MIN = 3;
const NAME_MAX = 16;

const remote: Remote = {
  act: (rev, actions) => net.act(rev, actions),
  read: () => net.readPlayer(),
  reset: () => net.resetPlayer(),
};

export class LoginScene extends BaseScene {
  private status!: Phaser.GameObjects.Text;
  private form?: Card;
  private busy = false;

  constructor() {
    super(SCENE.login);
  }

  create() {
    this.busy = false;
    this.form = undefined;
    this.setupScreen({ title: 'Cuber The Game', kicker: `ВЕРСИЯ ${__APP_VERSION__}`, back: null });
    this.status = text(this, GAME_W / 2, 560, '', { size: 15, color: COLOR.light, wrap: 760, align: 'center' }).setOrigin(0.5, 0);
    text(this, GAME_W / 2, 690, `сервер ${SERVER_ADDRESS}${net.profile ? ` · профиль ${net.profile}` : ''}`, { kind: 'mono', size: 12, color: COLOR.lightQuiet }).setOrigin(0.5, 0);
    if (net.hasSavedLogin) void this.enter();
    else this.showForm();
  }

  /** Форма нового игрока: имя и «Войти». */
  private showForm() {
    if (this.form) return;
    const card = new Card(this, GAME_W / 2 - 220, 250, 440, 270, { title: 'Новый игрок' });
    this.form = card;
    const c = card.content;
    const w = card.innerW;
    c.add(text(this, 0, 4, 'ИМЯ ИГРОКА', { size: 12, color: COLOR.inkQuiet, letterSpacing: 1 }));
    let name = '';
    const submit = () => {
      const value = name.trim();
      if (value.length < NAME_MIN) return this.say(`Имя — от ${NAME_MIN} до ${NAME_MAX} символов.`, true);
      void this.enter(value);
    };
    const field = new TextField(this, 0, 24, { width: w, maxLength: NAME_MAX, placeholder: 'Как тебя зовут', onChange: (v) => (name = v), onSubmit: submit });
    c.add(field);
    c.add(text(this, 0, 76, 'Имя видят другие игроки — в списке соперников и в таблице лидеров.', { size: 12, color: COLOR.inkQuiet, wrap: w }));
    c.add(new Button(this, w / 2, 150, 'Войти', { width: w, height: 52, size: 22, onClick: submit }));
    field.focus();
  }

  private say(message: string, error = false) {
    this.status.setText(message).setColor(error ? '#ff8a7a' : COLOR.light);
  }

  /** Вход и загрузка состояния; ошибка — текст под формой и повтор. */
  private async enter(name?: string) {
    if (this.busy) return;
    this.busy = true;
    this.say('Вход…');
    let view: PlayerView;
    try {
      view = await net.login(name);
    } catch (e) {
      this.busy = false;
      if (!this.scene.isActive()) return;
      const err = e instanceof NetError ? e : new NetError(String(e), 'server');
      this.say(err.message, true);
      // сохранённый вход не прошёл (нет связи, версии) — кнопка повтора; новый игрок — форма остаётся
      if (net.hasSavedLogin && !this.form) new Button(this, GAME_W / 2, 420, 'Повторить', { width: 260, height: 52, size: 22, onClick: () => this.scene.restart() });
      return;
    }
    store.hydrate(view, remote);
    this.go(SCENE.menu);
  }
}
