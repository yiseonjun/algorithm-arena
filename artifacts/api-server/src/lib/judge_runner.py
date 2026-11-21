import ast
import builtins
import json
import resource
import sys

MAX_CODE_LENGTH = 12000
MAX_AST_NODES = 2200
MAX_OUTPUT_LENGTH = 1200
MAX_MEMORY_BYTES = 192 * 1024 * 1024
CPU_SECONDS = 2

SAFE_BUILTIN_NAMES = {
    "abs", "all", "any", "bool", "dict", "enumerate", "float", "int",
    "len", "list", "max", "min", "range", "reversed", "round",
    "set", "sorted", "str", "sum", "tuple", "zip", "ord", "chr", "print",
}
SAFE_METHODS = {
    "append", "extend", "pop", "sort", "reverse", "count", "index",
    "get", "keys", "values", "items", "setdefault",
    "startswith", "endswith", "isdigit", "isalpha", "islower", "isupper",
    "lower", "upper", "strip", "split", "join", "replace", "find",
}
ALLOWED_NODE_TYPES = {
    ast.Module, ast.FunctionDef, ast.arguments, ast.arg, ast.Return,
    ast.Assign, ast.AugAssign, ast.For, ast.While, ast.If, ast.Expr,
    ast.Name, ast.Load, ast.Store, ast.Constant, ast.List, ast.Tuple,
    ast.Dict, ast.Set, ast.BinOp, ast.Add, ast.Sub, ast.Mult, ast.Div,
    ast.FloorDiv, ast.Mod, ast.Pow, ast.UnaryOp, ast.UAdd, ast.USub,
    ast.Not, ast.BoolOp, ast.And, ast.Or, ast.Compare, ast.Eq, ast.NotEq,
    ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.In, ast.NotIn, ast.Call,
    ast.Subscript, ast.Slice, ast.IfExp, ast.Break, ast.Continue,
    ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp, ast.comprehension,
    ast.keyword, ast.Attribute, ast.Pass,
}


def apply_limits():
    resource.setrlimit(resource.RLIMIT_CPU, (CPU_SECONDS, CPU_SECONDS))
    resource.setrlimit(resource.RLIMIT_AS, (MAX_MEMORY_BYTES, MAX_MEMORY_BYTES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (1024 * 1024, 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (16, 16))
    try:
        resource.setrlimit(resource.RLIMIT_NPROC, (1, 1))
    except (AttributeError, OSError, ValueError):
        pass


def validate_tree(tree, expected_function):
    if len(list(ast.walk(tree))) > MAX_AST_NODES:
        raise ValueError("코드가 채점기가 처리할 수 있는 복잡도를 초과했습니다.")

    function_names = {
        node.name for node in tree.body if isinstance(node, ast.FunctionDef)
    }
    if expected_function not in function_names:
        raise ValueError("필수 함수가 없습니다: " + expected_function)

    for node in ast.walk(tree):
        if type(node) not in ALLOWED_NODE_TYPES:
            raise ValueError("지원하지 않는 Python 문법이 포함되어 있습니다.")
        if isinstance(node, ast.Name) and node.id.startswith("_"):
            raise ValueError("밑줄(_)로 시작하는 이름은 사용할 수 없습니다.")
        if isinstance(node, ast.Attribute):
            if node.attr.startswith("_") or node.attr not in SAFE_METHODS:
                raise ValueError("채점기에서 사용할 수 없는 객체 속성입니다.")
        if isinstance(node, ast.FunctionDef):
            if node.decorator_list or node.args.vararg or node.args.kwarg:
                raise ValueError("데코레이터와 가변 인자는 사용할 수 없습니다.")
            if node.args.kw_defaults:
                raise ValueError("기본 키워드 인자는 사용할 수 없습니다.")
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                if node.func.id not in SAFE_BUILTIN_NAMES and node.func.id not in function_names:
                    raise ValueError("채점기에서 사용할 수 없는 함수입니다.")
            elif isinstance(node.func, ast.Attribute):
                if node.func.attr not in SAFE_METHODS:
                    raise ValueError("채점기에서 사용할 수 없는 메서드입니다.")
            else:
                raise ValueError("함수 또는 허용된 메서드만 직접 호출할 수 있습니다.")
    return function_names


def run(payload):
    code = payload.get("code", "")
    cases = payload.get("cases", [])
    function_name = payload.get("functionName", "")

    if not isinstance(code, str) or len(code) > MAX_CODE_LENGTH:
        return {
            "verdict": "CE", "passed": 0, "total": len(cases),
            "message": "코드는 12,000자 이하여야 합니다.", "output": None,
        }

    try:
        tree = ast.parse(code, mode="exec")
        validate_tree(tree, function_name)
    except SyntaxError as error:
        return {
            "verdict": "CE", "passed": 0, "total": len(cases),
            "message": str(error.lineno or 1) + "번째 줄에서 문법 오류가 발생했습니다.",
            "output": "올바른 Python 문법인지 확인해 주세요.",
        }
    except ValueError as error:
        return {
            "verdict": "CE", "passed": 0, "total": len(cases),
            "message": str(error)[:MAX_OUTPUT_LENGTH], "output": None,
        }

    captured = []

    def safe_print(*values, sep=" ", end="\n"):
        text = sep.join(str(value) for value in values) + end
        if sum(len(value) for value in captured) < MAX_OUTPUT_LENGTH:
            captured.append(text[:MAX_OUTPUT_LENGTH])

    safe_builtins = {
        name: getattr(builtins, name)
        for name in SAFE_BUILTIN_NAMES
        if name != "print"
    }
    safe_builtins["print"] = safe_print
    namespace = {"__builtins__": safe_builtins}

    try:
        exec(compile(tree, "<solution>", "exec"), namespace, namespace)
        solution = namespace.get(function_name)
        if not callable(solution):
            raise TypeError("The required function could not be loaded.")

        passed = 0
        mismatch = None
        for index, case in enumerate(cases):
            args = case.get("args", [])
            expected = case.get("expected")
            if not isinstance(args, list):
                raise TypeError("Test case arguments were invalid.")
            actual = solution(*args)
            if actual == expected:
                passed += 1
            else:
                mismatch = {
                    "case": index + 1,
                    "expected": expected,
                    "actual": actual,
                }
                break

        if mismatch is not None:
            output = json.dumps(mismatch, ensure_ascii=False, default=str)[:MAX_OUTPUT_LENGTH]
            return {
                "verdict": "WA", "passed": passed, "total": len(cases),
                "message": "일부 테스트 결과가 예상한 값과 다릅니다.",
                "output": output,
            }
        return {
            "verdict": "AC", "passed": passed, "total": len(cases),
            "message": "모든 테스트를 통과했습니다.",
            "output": ("".join(captured) or None),
        }
    except MemoryError:
        return {
            "verdict": "MLE", "passed": 0, "total": len(cases),
            "message": "메모리 제한을 초과했습니다.", "output": None,
        }
    except Exception as error:
        return {
            "verdict": "RE", "passed": 0, "total": len(cases),
            "message": "코드를 실행하는 중 오류가 발생했습니다 (" + type(error).__name__ + ").",
            "output": str(error)[:MAX_OUTPUT_LENGTH],
        }


def main():
    apply_limits()
    try:
        payload = json.loads(sys.stdin.read())
        result = run(payload)
    except Exception as error:
        result = {
            "verdict": "RE", "passed": 0, "total": 0,
            "message": "제출한 코드를 채점기가 읽을 수 없습니다.",
            "output": str(error)[:MAX_OUTPUT_LENGTH],
        }
    sys.stdout.write(json.dumps(result, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
