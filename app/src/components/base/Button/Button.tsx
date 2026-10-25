import styles from './Button.module.scss';
import { Button as ButtonBase } from '@base-ui/react/button';

type Props = {
    label: string;
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
} & (
        {
            type: 'button', onClick: () => void;
        } | { type: 'submit' }
    )

const Button = (props: Props) => {
    return (
        <ButtonBase disabled={props.disabled} type={props.type} onClick={props.type === 'button' ? props.onClick : undefined} className={styles.button}>
            {props.label}
        </ButtonBase>
    );
}

export default Button;
