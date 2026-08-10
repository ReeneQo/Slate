import { durationToMs } from './duration.schema';

describe('durationToMs', () => {
  test.each([
    ['7d', 604_800_000],
    ['24h', 86_400_000],
    ['30m', 1_800_000],
    ['3600s', 3_600_000],
    ['500ms', 500],
  ])('parses "%s" as %i ms', (input, expectedMs) => {
    // Arrange — input задан через test.each

    // Act
    const result = durationToMs.parse(input);

    // Assert
    expect(result).toBe(expectedMs);
  });

  test.each([
    '604800000', // старый формат без единицы — больше не поддержан
    '7 d', // пробел
    '1.5d', // дробное
    '7w', // неподдержанная единица (недель нет)
    '0d', // не положительное
    '',
  ])('rejects invalid format "%s"', (input) => {
    // Arrange / Act
    const result = durationToMs.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });
});
