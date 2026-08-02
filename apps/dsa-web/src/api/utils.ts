import camelcaseKeys from 'camelcase-keys';

/**
 * snake_case 객체 키를 camelCase로 변환
 * @param data API 응답 데이터 (snake_case)
 * @returns 변환된 camelCase 객체
 */
export function toCamelCase<T>(data: unknown): T {
    if (data === null || data === undefined) {
        return data as T;
    }
    return camelcaseKeys(data as Record<string, unknown>, { deep: true }) as T;
}
