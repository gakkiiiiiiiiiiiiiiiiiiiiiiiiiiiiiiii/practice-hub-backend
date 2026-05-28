import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { isIntegerYuanPrice } from '../utils/price.util';

@ValidatorConstraint({ name: 'isIntegerYuanPrice', async: false })
export class IsIntegerYuanPriceConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    if (value === undefined || value === null || value === '') {
      return true;
    }
    return isIntegerYuanPrice(Number(value));
  }

  defaultMessage() {
    return '价格必须为整数元';
  }
}

export function IsIntegerYuanPrice(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsIntegerYuanPriceConstraint,
    });
  };
}
