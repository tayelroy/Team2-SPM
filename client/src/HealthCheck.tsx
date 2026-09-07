import { useEffect, useState } from 'react';

export default function HealthCheck() {
  const [message, setMessage] = useState('Checking...');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP error: ${res.status} ${res.statusText}`);
        }
        return res.json();
      })
      .then((data) => setMessage(JSON.stringify(data)))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Unknown connection error';
        setMessage(`Error: ${msg}`);
      });
  }, []);

  return <div>{message}</div>;
}
