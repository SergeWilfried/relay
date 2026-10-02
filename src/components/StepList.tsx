import { useT } from '../i18n';

export function StepList({ steps, step, done, failedAt }: { steps: [string, string][]; step: number; done: boolean; failedAt?: number }) {
  const { t } = useT();
  return (
    <div className="steps" role="list">
      {steps.map(([label, detail], i) => {
        const st = failedAt === i ? 'failed' : step > i ? 'done' : step === i && !done && failedAt === undefined ? 'active' : 'pending';
        return (
          <div className="step" key={i} role="listitem">
            <div className={`step-n ${st}`}>{st === 'done' ? '✓' : st === 'failed' ? '✕' : st === 'active' ? '•' : i + 1}</div>
            <div>
              <div className={`step-t ${st}`}>{label}</div>
              <div className="step-d">{st === 'failed' ? t("This step didn't complete") : detail}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
