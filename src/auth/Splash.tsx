import { Spinner } from '../components/Spinner';

export const Splash = () => (
  <div className="splash" role="status" aria-label="Loading">
    <div className="logo-mark" style={{ width: 44, height: 44, borderRadius: 13, fontSize: 22 }}>R</div>
    <Spinner />
  </div>
);
