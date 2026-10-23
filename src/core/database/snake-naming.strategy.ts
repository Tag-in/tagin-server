import { DefaultNamingStrategy, type NamingStrategyInterface } from 'typeorm';

const toSnakeCase = (value: string) =>
  value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

// 엔티티는 camelCase, DB 컬럼은 snake_case로 매핑한다. 명시한 name은 그대로 사용한다.
export class SnakeNamingStrategy
  extends DefaultNamingStrategy
  implements NamingStrategyInterface
{
  columnName(
    propertyName: string,
    customName: string | undefined,
    embeddedPrefixes: string[],
  ): string {
    const prefix = toSnakeCase(embeddedPrefixes.concat('').join('_'));
    return prefix + (customName ?? toSnakeCase(propertyName));
  }

  relationName(propertyName: string): string {
    return toSnakeCase(propertyName);
  }

  joinColumnName(relationName: string, referencedColumnName: string): string {
    return toSnakeCase(`${relationName}_${referencedColumnName}`);
  }
}
