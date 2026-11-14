import nozhikUrl from '../assets/fonts/Nozhik-Bold.otf?url';
import robotoUrl from '../assets/fonts/RobotoCondensed-VariableFont_wght.ttf?url';
import monoUrl from '../assets/fonts/JetBrainsMono-VariableFont_wght.ttf?url';

/** Те же шрифты, что в Unity-клиенте (Assets/Resources/Fonts). */
export const FONT = {
  display: 'Nozhik', // заголовки и кнопки, только КАПСОМ
  body: 'Roboto Condensed',
  mono: 'JetBrains Mono',
} as const;

export async function loadFonts(): Promise<void> {
  const faces = [
    new FontFace(FONT.display, `url(${nozhikUrl})`),
    new FontFace(FONT.body, `url(${robotoUrl})`, { weight: '100 900' }),
    new FontFace(FONT.mono, `url(${monoUrl})`, { weight: '100 800' }),
  ];
  await Promise.all(
    faces.map(async (face) => {
      await face.load();
      document.fonts.add(face);
    }),
  );
}
