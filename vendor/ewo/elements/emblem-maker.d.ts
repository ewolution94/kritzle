import { EwoElement } from './base';
import './emblem';
/**
 * Choose an emblem: arrows per part around the big emblem, and a dice.
 *
 * @tagname ewo-emblem-maker
 * @attr {'heraldry' | 'doodle' | 'token'} theme - Which generator (default heraldry).
 * @attr {string} value - The numbers, comma-separated; the `value` property also takes an array. Random when missing.
 * @fires change - `detail: { value: number[] }` after a step or a roll.
 * @cssprop --ewo-emblem-maker-size - The big emblem's stage (default 200px).
 * @csspart arrow - Each arrow button.
 * @csspart stage - The square the emblem sits on.
 * @csspart tag - The strip naming the new choice.
 * @csspart legend - The part names under the stage.
 * @csspart dice - The roll button.
 */
export declare class EwoEmblemMaker extends EwoElement {
    #private;
    static styles: CSSStyleSheet[];
    static observedAttributes: string[];
    connectedCallback(): void;
    disconnectedCallback(): void;
    attributeChangedCallback(name: string): void;
    get theme(): string;
    set theme(v: string);
    get value(): number[];
    set value(v: number[] | string);
}
declare global {
    interface HTMLElementTagNameMap {
        'ewo-emblem-maker': EwoEmblemMaker;
    }
}
