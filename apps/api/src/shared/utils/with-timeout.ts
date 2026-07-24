/**
 * Оборачивает промис таймаутом. Нужен для health-проверок: если зависимость (БД/Redis)
 * подвисла (сеть, оборванный коннект), проба не должна висеть бесконечно — по таймауту
 * получаем reject и отдаём 503, а не держим соединение открытым.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
