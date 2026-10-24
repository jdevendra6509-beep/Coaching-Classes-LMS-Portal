import { BadRequestException, PipeTransform } from "@nestjs/common";

/** Route param "YYYY-MM-DD" → Date at UTC midnight (matches Postgres DATE columns). */
export class ParseDatePipe implements PipeTransform<string, Date> {
  transform(value: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException("Date must be YYYY-MM-DD");
    const d = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new BadRequestException("Invalid date");
    return d;
  }
}

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
