export const Spinner = ({ size = 14, large }: { size?: number; large?: boolean }) => (
  <div className={`spin${large ? ' lg' : ''}`} style={large ? undefined : { width: size, height: size }} role="status" aria-label="Loading" />
);
