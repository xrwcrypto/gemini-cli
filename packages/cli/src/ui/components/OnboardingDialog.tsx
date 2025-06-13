
import { Box, Text } from 'ink';
import { RadioButtonSelect, type RadioSelectItem } from './shared/RadioButtonSelect.js';
import { Colors } from '../colors.js';

interface OnboardingDialogProps {
    onSelect: (value: string) => void;
}

const ONBOARDING_CHOICES: RadioSelectItem<string>[] = [
    {
        label: 'Acknowledge',
        value: 'acknowledge',
    },
    {
        label: 'Disable',
        value: 'disable',
    },
];

export function OnboardingDialog({ onSelect }: OnboardingDialogProps) {
    return (
        <Box
            borderStyle="round"
            borderColor={Colors.AccentYellow}
            paddingX={1}
            marginY={1}
            flexDirection="column"
        >
            <Text>
                To help improve the product, we collect anonymized data about how the app is used.
            </Text>
            <Text>
                You can change this later in the settings.
            </Text>
            <RadioButtonSelect
                items={ONBOARDING_CHOICES}
                onSelect={onSelect}
            />
        </Box>
    );
}
