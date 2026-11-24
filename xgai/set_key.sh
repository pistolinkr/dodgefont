#!/bin/sh
# Anthropic API 키를 화면에 표시하지 않고 입력받아 xgai/.env 에 저장한다 (권한 600, git 무시됨).
cd "$(dirname "$0")" || exit 1
printf 'Anthropic API 키를 붙여넣고 Enter (화면에 표시되지 않음): '
stty -echo
read -r KEY
stty echo
echo
case "$KEY" in
  sk-ant-*) ;;
  *) echo "sk-ant- 로 시작하지 않습니다. 저장하지 않았습니다."; exit 1 ;;
esac
umask 077
printf 'ANTHROPIC_API_KEY=%s\n' "$KEY" > .env
unset KEY
echo "저장 완료: xgai/.env (권한 600)"
