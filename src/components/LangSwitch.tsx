import { useT } from '../i18n';

/** FR / EN toggle (French is the default). */
export function LangSwitch() {
  const { lang, setLang } = useT();
  return (
    <div className="seg" role="group" aria-label="Langue / Language">
      <button className={lang === 'fr' ? 'on' : ''} onClick={() => setLang('fr')} lang="fr">Français</button>
      <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')} lang="en">English</button>
    </div>
  );
}
