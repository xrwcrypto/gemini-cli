
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
        label: 'Disable PII data collection',
        value: 'disable_pii',
    },
    {
        label: 'Disable all data collection',
        value: 'disable',
    },
];

export function OnboardingDialog({ onSelect }: OnboardingDialogProps) {
    return (
        <Box borderStyle="round"
          borderColor={Colors.Gray}
          flexDirection="column"
          padding={1}
          width="100%">
            <Text>
                To help improve Gemini CLI, we collect anonymized data about how the app is used.
            </Text>
            <Text>
                You can change this setting at any time by editing your ~/.gemini/settings.json file.

            </Text>
            <RadioButtonSelect
                paddingTop={2}
                items={ONBOARDING_CHOICES}
                onSelect={onSelect}
            />
        </Box>
    );
}
