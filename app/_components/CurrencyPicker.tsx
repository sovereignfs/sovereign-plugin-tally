'use client';

import { Combobox } from '@sovereignfs/ui';
import { PICKER_CURRENCY_OPTIONS } from '../_lib/currencies';

const OPTIONS = PICKER_CURRENCY_OPTIONS.map((c) => ({ value: c.code, label: c.label }));

interface CurrencyPickerProps {
  /** Form field name — submitted via a hidden input, since `Combobox` has
   *  no native form participation of its own. */
  name: string;
  value: string;
  onChange: (code: string) => void;
  'aria-label': string;
  id?: string;
  disabled?: boolean;
}

/**
 * Searchable ISO 4217 picker — `Combobox` over the 162-code list with the
 * common currencies first (`PICKER_CURRENCY_OPTIONS`), replacing the plain
 * `<select>` every form used to scroll through. Controlled: the caller owns
 * the value so it can drive defaults (a group's currency, the user's
 * primary currency) and read it back for live split-remainder maths.
 */
export function CurrencyPicker({
  name,
  value,
  onChange,
  id,
  disabled,
  ...rest
}: CurrencyPickerProps) {
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Combobox
        options={OPTIONS}
        value={value}
        onChange={onChange}
        placeholder="Choose a currency"
        searchPlaceholder="Search currencies"
        emptyMessage="No matching currency"
        aria-label={rest['aria-label']}
        disabled={disabled}
        className={id ? undefined : undefined}
      />
    </>
  );
}
