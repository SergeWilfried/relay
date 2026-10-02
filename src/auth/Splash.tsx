import { Spinner } from '../components/Spinner';
import { tr } from '../i18n';

export const Splash = () => (
  <div className="splash" role="status" aria-label={tr('Loading')}>
    <div className="logo-mark" style={{ width: 44, height: 44, borderRadius: 13, fontSize: 22 }}>R</div>
    <Spinner />
  </div>
);
